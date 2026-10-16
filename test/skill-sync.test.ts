import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it } from "node:test";

const canonicalRoot = "skills/shared-memory";
const pluginRoot = "plugin/shared-memory/skills/shared-memory";

function listFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) {
        if (entry === "agents") continue;
        walk(path);
      } else {
        out.push(relative(root, path));
      }
    }
  };
  walk(root);
  return out.sort();
}

describe("shared-memory skill packaging", () => {
  it("keeps canonical and plugin skill trees identical (except agents/)", () => {
    const canonical = listFiles(canonicalRoot);
    const plugin = listFiles(pluginRoot);
    assert.deepEqual(
      plugin,
      canonical,
      `plugin skill files differ from canonical:\nplugin=${plugin.join(",")}\ncanonical=${canonical.join(",")}`,
    );
    for (const file of canonical) {
      assert.equal(
        readFileSync(join(pluginRoot, file), "utf8"),
        readFileSync(join(canonicalRoot, file), "utf8"),
        `${file} content differs between plugin and canonical copies`,
      );
    }
  });

  it("SKILL.md has required frontmatter and when-to-use routing", () => {
    const skill = readFileSync(join(canonicalRoot, "SKILL.md"), "utf8");
    assert.match(skill, /^---\nname: shared-memory\n/);
    assert.match(skill, /description:/);
    assert.match(skill, /## When to use/);
    assert.match(skill, /Never store passwords/);
    assert.match(skill, /memory_instructions/);
    assert.match(skill, /references\/evals\.md/);
    assert.ok(
      !/<(?:anthropic|claude|script|img)\b/i.test(skill),
      "skill must not embed reserved/XML-like tags",
    );
  });
});
