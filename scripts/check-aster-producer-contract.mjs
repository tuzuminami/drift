import { createHash } from "node:crypto";

const tag = "v2.0.0";
const base = `https://raw.githubusercontent.com/tuzuminami/aster/${tag}/packages/contracts`;
const sources = {
  schema: { url: `${base}/schemas/compiled-bundle.schema.json`, sha256: "507149011e7a474389728efedb932ad620f8e1290b980e9710728263af3a0fee" },
  fixture: { url: `${base}/fixtures/compiled-bundle.v1.json`, sha256: "eb2e46d01797b41ce593f2f4cdfa187327a375322e2aff3d992224c0daab74d7" }
};

const [schema, fixture] = await Promise.all(Object.values(sources).map(async ({ url, sha256 }) => {
  const response = await fetch(url, { redirect: "error" });
  if (!response.ok) throw new Error(`ASTER producer artifact retrieval failed: ${response.status} ${url}`);
  const text = await response.text();
  if (createHash("sha256").update(text).digest("hex") !== sha256) throw new Error(`ASTER producer artifact digest drifted: ${url}`);
  return JSON.parse(text);
}));

if (schema.$id !== "https://tuzuminami.github.io/aster/contracts/compiled-bundle/1.1.0/schema.json" || schema["x-aster-contract-version"] !== "1.1.0") throw new Error("ASTER producer schema version is unsupported");
if (fixture.compilerVersion !== "aster-compiler/0.2.0" || !/^[a-f0-9]{64}$/.test(fixture.contentHash) || !fixture.integrity || !fixture.context || !fixture.provenance) throw new Error("ASTER producer fixture is malformed");
console.log(`aster-producer-contract: verified ${tag}`);
