import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it } from "node:test";

const packagedSkills = [
  "shared-memory",
  "shared-space-watch-muse",
  "shared-space-watch-grok",
  "shared-space-watch-dot",
];

const hostSkills = packagedSkills.slice(1);

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

describe("skill packaging", () => {
  it("does not ship generic watch or tick skills", () => {
    for (const name of ["shared-space-watch", "shared-space-watch-tick"]) {
      assert.equal(existsSync(join("skills", name)), false, name);
      assert.equal(
        existsSync(join("plugin/shared-memory/skills", name)),
        false,
        `plugin ${name}`,
      );
    }
  });

  for (const name of packagedSkills) {
    it(`keeps canonical and plugin ${name} trees identical (except agents/)`, () => {
      const canonicalRoot = join("skills", name);
      const pluginRoot = join("plugin/shared-memory/skills", name);
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
          `${file} content differs between plugin and canonical ${name}`,
        );
      }
    });
  }

  it("shared-memory SKILL.md has required frontmatter and when-to-use routing", () => {
    const skill = readFileSync("skills/shared-memory/SKILL.md", "utf8");
    assert.match(skill, /^---\nname: shared-memory\n/);
    assert.match(skill, /## When to use/);
    assert.match(skill, /Never store passwords/);
    assert.match(skill, /memory_instructions/);
    assert.match(skill, /shared-space-watch-muse/);
    assert.ok(!/<(?:anthropic|claude|script|img)\b/i.test(skill));
  });

  it("host skills embed operating-guide and identical tick.md", () => {
    const ticks = hostSkills.map((name) =>
      readFileSync(join("skills", name, "references/tick.md"), "utf8"),
    );
    for (const t of ticks.slice(1)) assert.equal(t, ticks[0]);
    for (const name of hostSkills) {
      const skill = readFileSync(join("skills", name, "SKILL.md"), "utf8");
      const guide = readFileSync(
        join("skills", name, "references/operating-guide.md"),
        "utf8",
      );
      assert.match(skill, /references\/operating-guide\.md/);
      assert.match(skill, /references\/tick\.md/);
      assert.match(guide, /# Shared Memory operating guide/);
      assert.doesNotMatch(skill, /Use skill shared-space-watch-tick/);
    }
  });
});
