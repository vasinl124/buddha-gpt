# The Go core (buddha serve: the Retrieval API and accounts). Built from the repo root, as Railway
# does with RAILWAY_DOCKERFILE_PATH=services/core/Dockerfile.
FROM golang:1.26-alpine AS build
WORKDIR /src
COPY services/core/go.mod services/core/go.sum ./
RUN go mod download
COPY services/core/ ./
RUN CGO_ENABLED=0 go build -trimpath -o /buddha ./cmd/buddha

# distroless/static carries the CA certificates the embedding calls need
FROM gcr.io/distroless/static-debian12
COPY --from=build /buddha /buddha
# every interface of the container, so the agent can reach it over the private network
ENV CORE_ADDR=:7890
EXPOSE 7890
ENTRYPOINT ["/buddha", "serve"]
