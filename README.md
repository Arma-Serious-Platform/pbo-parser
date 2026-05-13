# pbo-parser
Parsing pbo to extract slots, briefing, etc from any .pbo file with a mission.sqm

## Installation

### Locally
1. `npm i`
2. `npm run build`
3. `npm run dev` # for local development or `npm run start` to production run

### Using docker container

Build the image from the project root:

```bash
docker build -t pbo-parser .
```

Run the container, exposing the API on port `3000`:

```bash
docker run --rm -p 3000:3000 --name pbo-parser pbo-parser
```

To override the port, set the `PORT` environment variable and map it accordingly:

```bash
docker run --rm -e PORT=8080 -p 8080:8080 --name pbo-parser pbo-parser
```

### ARM VPS: `exec format error`

The image is **linux/amd64** (native Arma tooling is x86-64). On an **aarch64** VPS, Docker must use QEMU; without it, startup fails with `exec format error` on the entrypoint or `node`.

1. On the VPS, install binfmt handlers (once per host):

   ```bash
   docker run --privileged --rm tonistiigi/binfmt --install all
   ```

2. Ensure Compose or `docker run` uses the amd64 image, e.g. `--platform linux/amd64`, then recreate the container.

3. Prefer an **x86_64** VPS if you want native speed without emulation.

## Usage

Check the `docs/openapi` for the endpoints example.
The main endpoints:
- `/zip` - Get the unpackacked PBO (and debinary mission.sqm) in zip archive, `.pbo` file required
- `/slots` - Get the slots from a mission by `.pbo` file
- `/full` - Get briefing & slots in one response

## TODO:
- `/briefing` - Get the briefing from a `.pbo` file