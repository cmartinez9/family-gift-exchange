import {execFileSync} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync} from "node:fs";
import {createServer} from "node:https";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {getCACertificates, setDefaultCACertificates} from "node:tls";
import next from "next";

const temp = mkdtempSync(join(tmpdir(), "fge-playwright-"));
const keyPath = join(temp, "key.pem");
const certPath = join(temp, "cert.pem");
let tls;
try {
  execFileSync("openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
    "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost",
    "-keyout", keyPath, "-out", certPath,
  ], {stdio: "ignore"});
  tls = {key: readFileSync(keyPath), cert: readFileSync(certPath)};
} finally {
  rmSync(temp, {recursive: true, force: true});
}

// Server Actions fetch local redirects from the same HTTPS origin.
setDefaultCACertificates([...getCACertificates("default"), tls.cert.toString("utf8")]);

const port = Number(process.env.E2E_PORT || 3100);
const app = next({dev: false, hostname: "localhost", port});
await app.prepare();
const handle = app.getRequestHandler();
createServer(tls, (request, response) => void handle(request, response)).listen(port, "127.0.0.1");
