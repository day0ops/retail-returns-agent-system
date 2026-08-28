// Command stage-policy-controller is a small internal service (not
// customer-facing -- only reachable from the guided-tour UI's own BFF over
// cluster-internal networking) that applies/removes a fixed, named set of
// EnterpriseAgentgatewayPolicy resources on demand. It exists so the guided
// tour can be "clickops": a presenter's "Apply policy" / "Remove policy"
// button controls whether a stage's backend policy actually exists in the
// cluster, instead of every policy being pre-provisioned as part of infra
// setup (agentic-field-kit's usecase deploy) before the tour ever starts --
// which meant an earlier stage's own demo could be silently affected by a
// later stage's policy despite never having visited that stage yet.
//
// Deliberately narrow: this service's own RBAC (see agentic-field-kit's
// stage-policy-rbac feature) is scoped by resourceNames to just the specific
// objects it's allowed to create/mutate -- it cannot touch arbitrary cluster
// resources, even though it runs with real Kubernetes API credentials.
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
)

// One entry per clickops-controlled stage. Only "tool-policy" exists today
// (Stage 4's pilot) -- adding a stage means adding an entry here, not a new
// service or API shape.
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
// created for this MCP server -- the same label-selector pattern agentic-field-kit's
// own JS features use (backend names are hash-suffixed and not knowable ahead of
// time). Filters on ownerKind=Deployment since AgentRegistry also creates a second,
// MCPServer-owned Backend per server at a different, unrelated path.
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
	// last-applied-configuration conflicts a naive get-then-create-or-update
	// (or a stale manually-restored object) can hit.
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

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	log.Printf("stage-policy-controller listening on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, mux))
}
