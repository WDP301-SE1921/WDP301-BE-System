# Build MinIO Client (mc) from official source
FROM golang:1.24-alpine AS mc-builder

# Fixed MinIO Client release version and commit hash
ARG MC_VERSION=RELEASE.2025-08-13T08-35-41Z
ARG MC_COMMIT=7394ce0dd2a80935aded936b09fa12cbb3cb8096

RUN apk add --no-cache git ca-certificates tzdata

WORKDIR /go/src/github.com/minio/mc
RUN git clone https://github.com/minio/mc.git . && \
    git checkout ${MC_COMMIT} && \
    CGO_ENABLED=0 GO111MODULE=on go build -v --ldflags "-s -w" -o /go/bin/mc .

# Final minimal MinIO Client runtime image
FROM alpine:3.21

LABEL maintainer="EduGrade Team"
LABEL mc.version="RELEASE.2025-08-13T08-35-41Z"

RUN apk add --no-cache ca-certificates curl bash tzdata

COPY --from=mc-builder /go/bin/mc /usr/bin/mc
COPY docker/minio-init/entrypoint.sh /usr/local/bin/minio-init.sh
RUN chmod +x /usr/local/bin/minio-init.sh

ENTRYPOINT ["/usr/local/bin/minio-init.sh"]
