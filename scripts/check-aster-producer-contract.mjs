import { createHash } from "node:crypto";

const tag = "v1.0.1";
const base = `https://raw.githubusercontent.com/tuzuminami/aster/${tag}/packages/contracts`;
const sources = {
  schema: { url: `${base}/schemas/compiled-bundle.schema.json`, sha256: "c9afdfb291b161b5758b8c2de247a45fc7370c5b6ead46a7ce700548bcb8ed7a" },
  fixture: { url: `${base}/fixtures/compiled-bundle.v1.json`, sha256: "07f8cc01510684f3d6cf684b221e56a8352823ccd01b573d413213275ec4a375" }
};

const [schema, fixture] = await Promise.all(Object.values(sources).map(async ({ url, sha256 }) => {
  const response = await fetch(url, { redirect: "error" });
  if (!response.ok) throw new Error(`ASTER producer artifact retrieval failed: ${response.status} ${url}`);
  const text = await response.text();
  if (createHash("sha256").update(text).digest("hex") !== sha256) throw new Error(`ASTER producer artifact digest drifted: ${url}`);
  return JSON.parse(text);
}));

if (schema.$id !== "https://tuzuminami.github.io/aster/contracts/compiled-bundle/1.0.0/schema.json" || schema["x-aster-contract-version"] !== "1.0.0") throw new Error("ASTER producer schema version is unsupported");
if (fixture.compilerVersion !== "aster-compiler/0.1.0" || !/^[a-f0-9]{64}$/.test(fixture.contentHash) || !fixture.context || !fixture.provenance) throw new Error("ASTER producer fixture is malformed");
console.log(`aster-producer-contract: verified ${tag}`);
