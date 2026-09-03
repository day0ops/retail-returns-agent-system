// Command stage-policy-controller is an internal service (reachable only from
// the guided-tour BFF over cluster-internal networking) that applies/removes a
// fixed, named set of EnterpriseAgentgatewayPolicy resources on demand, letting
// the guided tour toggle a stage's backend policy via "Apply"/"Remove" buttons.
// Pre-provisioning every policy up front instead let a later stage's policy
// silently affect an earlier stage before it was ever visited.
//
// Its RBAC (agentic-field-kit's stage-policy-rbac feature) is scoped by
// resourceNames to just the objects it may create/mutate, so it cannot touch
// arbitrary cluster resources despite holding real Kubernetes API credentials.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"os"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/rest"
)

var (
	policyGVR = schema.GroupVersionResource{
		Group: "enterpriseagentgateway.solo.io", Version: "v1alpha1", Resource: "enterpriseagentgatewaypolicies",
	}
	backendGVR = schema.GroupVersionResource{
		Group: "enterpriseagentgateway.solo.io", Version: "v1alpha1", Resource: "enterpriseagentgatewaybackends",
	}
	budgetGVR = schema.GroupVersionResource{
		Group: "enterpriseagentgateway.solo.io", Version: "v1alpha1", Resource: "enterpriseagentgatewaybudgets",
	}
	accessPolicyGVR = schema.GroupVersionResource{
		Group: "policy.kagent-enterprise.solo.io", Version: "v1alpha1", Resource: "accesspolicies",
	}
)

// viewRef points at one already-provisioned object a policy view shows: read-only,
// never mutated here (RBAC for these Gets comes from agentic-field-kit's readOnlyRefs).
type viewRef struct {
	gvr       schema.GroupVersionResource
	kind      string
	name      string
	namespace string
}

// policyViews are read-only views over pre-provisioned policy objects this
// service doesn't manage: unlike stages there's no apply/remove, just "show
// what's live". A view can span multiple objects (e.g. budget's cap plus its
// separate enforcement policy).
var policyViews = map[string][]viewRef{
	"budget": {
		{gvr: budgetGVR, kind: "EnterpriseAgentgatewayBudget", name: "retail-returns-customer-budgets", namespace: "agentgateway-proxy"},
		{gvr: policyGVR, kind: "EnterpriseAgentgatewayPolicy", name: "retail-returns-budget-enforcement", namespace: "agentgateway-proxy"},
	},
	"pii-guardrail": {
		{gvr: policyGVR, kind: "EnterpriseAgentgatewayPolicy", name: "retail-returns-pii-guardrail", namespace: "agentregistry-system"},
	},
	"access-policy-agent": {
		{gvr: accessPolicyGVR, kind: "AccessPolicy", name: "retail-returns-fraud-check-jwt-claim", namespace: "kagent"},
	},
	"access-policy-tool": {
		{gvr: accessPolicyGVR, kind: "AccessPolicy", name: "retail-returns-deny-override-return-window", namespace: "kagent"},
	},
}

// One entry per clickops-controlled stage; adding a stage means a new entry
// here, not a new service or API shape.
var stages = map[string]stageDef{
	"tool-policy": {
		policyName:      "retail-returns-refund-identity-deny",
		policyNamespace: "agentregistry-system",
		mcpServerName:   "payment",
		matchExpression: "mcp.tool.name == 'refund_payment' && 'customers' in jwt.Groups",
	},
}

type stageDef struct {
	policyName      string
	policyNamespace string
	mcpServerName   string
	matchExpression string
}

func (s stageDef) buildPolicy(backendName string) *unstructured.Unstructured {
	return &unstructured.Unstructured{Object: map[string]any{
		"apiVersion": "enterpriseagentgateway.solo.io/v1alpha1",
		"kind":       "EnterpriseAgentgatewayPolicy",
		"metadata": map[string]any{
			"name":      s.policyName,
			"namespace": s.policyNamespace,
			"labels": map[string]any{
				"app.kubernetes.io/managed-by": "stage-policy-controller",
			},
		},
		"spec": map[string]any{
			"targetRefs": []any{
				map[string]any{
					"group": "enterpriseagentgateway.solo.io",
					"kind":  "EnterpriseAgentgatewayBackend",
					"name":  backendName,
				},
			},
			"backend": map[string]any{
				"mcp": map[string]any{
					"authorization": map[string]any{
						"action": "Deny",
						"policy": map[string]any{
							"matchExpressions": []any{s.matchExpression},
						},
					},
				},
			},
		},
	}}
}

// discoverBackendName finds the live EnterpriseAgentgatewayBackend AgentRegistry
// created for this MCP server by label selector, since backend names are
// hash-suffixed and not knowable ahead of time. Filters ownerKind=Deployment
// because AgentRegistry also creates a second, MCPServer-owned Backend per server.
func discoverBackendName(ctx context.Context, client dynamic.Interface, s stageDef) (string, error) {
	list, err := client.Resource(backendGVR).Namespace(s.policyNamespace).List(ctx, metav1.ListOptions{
		LabelSelector: "agentregistry.solo.io/ownerName=" + s.mcpServerName + ",agentregistry.solo.io/ownerKind=Deployment",
	})
	if err != nil {
		return "", err
	}
	if len(list.Items) != 1 {
		return "", errors.New("expected exactly 1 live Backend for MCP server " + s.mcpServerName)
	}
	return list.Items[0].GetName(), nil
}

type server struct {
	client dynamic.Interface
}

func (srv *server) lookupStage(w http.ResponseWriter, r *http.Request) (stageDef, bool) {
	name := r.PathValue("stage")
	s, ok := stages[name]
	if !ok {
		http.Error(w, "unknown stage: "+name, http.StatusNotFound)
		return stageDef{}, false
	}
	return s, true
}

func (srv *server) handleApply(w http.ResponseWriter, r *http.Request) {
	s, ok := srv.lookupStage(w, r)
	if !ok {
		return
	}
	ctx := r.Context()
	backendName, err := discoverBackendName(ctx, srv.client, s)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	policy := s.buildPolicy(backendName)
	data, err := json.Marshal(policy)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	// Server-side apply: idempotent, and avoids the resourceVersion/
	// last-applied-configuration conflicts a naive get-then-create-or-update can hit.
	_, err = srv.client.Resource(policyGVR).Namespace(s.policyNamespace).Patch(
		ctx, s.policyName, types.ApplyPatchType, data,
		metav1.PatchOptions{FieldManager: "stage-policy-controller", Force: boolPtr(true)},
	)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	writeJSON(w, map[string]any{"applied": true, "backend": backendName})
}

func (srv *server) handleRemove(w http.ResponseWriter, r *http.Request) {
	s, ok := srv.lookupStage(w, r)
	if !ok {
		return
	}
	err := srv.client.Resource(policyGVR).Namespace(s.policyNamespace).Delete(r.Context(), s.policyName, metav1.DeleteOptions{})
	if err != nil && !apierrors.IsNotFound(err) {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	writeJSON(w, map[string]any{"applied": false})
}

func (srv *server) handleStatus(w http.ResponseWriter, r *http.Request) {
	s, ok := srv.lookupStage(w, r)
	if !ok {
		return
	}
	_, err := srv.client.Resource(policyGVR).Namespace(s.policyNamespace).Get(r.Context(), s.policyName, metav1.GetOptions{})
	if err != nil {
		if apierrors.IsNotFound(err) {
			writeJSON(w, map[string]any{"applied": false})
			return
		}
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	writeJSON(w, map[string]any{"applied": true})
}

// handleSpec returns this stage's policy spec: the live object's spec if applied,
// otherwise the spec applying would create (same discoverBackendName lookup as
// handleApply), so a presenter can preview it before clicking "Apply".
func (srv *server) handleSpec(w http.ResponseWriter, r *http.Request) {
	s, ok := srv.lookupStage(w, r)
	if !ok {
		return
	}
	ctx := r.Context()
	live, err := srv.client.Resource(policyGVR).Namespace(s.policyNamespace).Get(ctx, s.policyName, metav1.GetOptions{})
	if err == nil {
		writeJSON(w, map[string]any{"applied": true, "spec": live.Object["spec"]})
		return
	}
	if !apierrors.IsNotFound(err) {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	backendName, err := discoverBackendName(ctx, srv.client, s)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	policy := s.buildPolicy(backendName)
	writeJSON(w, map[string]any{"applied": false, "spec": policy.Object["spec"]})
}

// handlePolicyView returns the spec of every object in a named policy view.
// These are pre-provisioned, so unlike handleSpec there's no "would create"
// fallback: a missing object is reported per-object, not failed wholesale.
func (srv *server) handlePolicyView(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	refs, ok := policyViews[name]
	if !ok {
		http.Error(w, "unknown policy view: "+name, http.StatusNotFound)
		return
	}
	ctx := r.Context()
	objects := make([]map[string]any, 0, len(refs))
	for _, ref := range refs {
		obj, err := srv.client.Resource(ref.gvr).Namespace(ref.namespace).Get(ctx, ref.name, metav1.GetOptions{})
		if err != nil {
			if apierrors.IsNotFound(err) {
				objects = append(objects, map[string]any{
					"kind": ref.kind, "name": ref.name, "namespace": ref.namespace, "found": false,
				})
				continue
			}
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
		objects = append(objects, map[string]any{
			"kind": ref.kind, "name": ref.name, "namespace": ref.namespace,
			"found": true, "spec": obj.Object["spec"],
		})
	}
	writeJSON(w, map[string]any{"objects": objects})
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

func boolPtr(v bool) *bool { return &v }

func main() {
	config, err := rest.InClusterConfig()
	if err != nil {
		log.Fatalf("failed to load in-cluster config: %v", err)
	}
	client, err := dynamic.NewForConfig(config)
	if err != nil {
		log.Fatalf("failed to create dynamic client: %v", err)
	}
	srv := &server{client: client}

	mux := http.NewServeMux()
	mux.HandleFunc("POST /stages/{stage}/apply", srv.handleApply)
	mux.HandleFunc("POST /stages/{stage}/remove", srv.handleRemove)
	mux.HandleFunc("GET /stages/{stage}/status", srv.handleStatus)
	mux.HandleFunc("GET /stages/{stage}/spec", srv.handleSpec)
	mux.HandleFunc("GET /policies/{name}/spec", srv.handlePolicyView)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	log.Printf("stage-policy-controller listening on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, mux))
}
