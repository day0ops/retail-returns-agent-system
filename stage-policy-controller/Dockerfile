FROM golang:1.27-alpine AS builder
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /out/app .

FROM gcr.io/distroless/static-debian12
COPY --from=builder /out/app /app
EXPOSE 8080
ENTRYPOINT ["/app"]
