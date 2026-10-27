# Build MinIO Server from official source
FROM golang:1.24-alpine AS minio-builder

# Fixed MinIO release version and commit hash
ARG MINIO_VERSION=RELEASE.2025-09-07T16-13-09Z
ARG MINIO_COMMIT=07c3a429bfed433e49018cb0f78a52145d4bedeb

RUN apk add --no-cache git ca-certificates tzdata

WORKDIR /go/src/github.com/minio/minio
RUN git clone https://github.com/minio/minio.git . && \
    git checkout ${MINIO_COMMIT} && \
    CGO_ENABLED=0 GO111MODULE=on go build -v --ldflags "-s -w" -o /go/bin/minio .

# Final minimal MinIO server runtime image
FROM alpine:3.21

LABEL maintainer="EduGrade Team"
LABEL minio.version="RELEASE.2025-09-07T16-13-09Z"

RUN apk add --no-cache ca-certificates curl jq tzdata && \
    addgroup -g 1000 -S minio && \
    adduser -u 1000 -S minio -G minio && \
    mkdir -p /data && \
    chown -R minio:minio /data

COPY --from=minio-builder /go/bin/minio /usr/bin/minio

EXPOSE 9000 9001
VOLUME ["/data"]

USER minio
ENTRYPOINT ["/usr/bin/minio"]
CMD ["server", "/data", "--console-address", ":9001"]
