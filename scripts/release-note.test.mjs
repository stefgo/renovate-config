import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { HEADING, LOCK_LINE, entries, updateNotes } from "./release-note.mjs";

const TEMPLATE = "<!--\nThe hand-written part of the next release.\n-->\n";

const fastify = { depName: "fastify", manager: "npm", depType: "dependencies", currentVersion: "5.6.1", newVersion: "5.7.0" };
const nodeImage = (currentValue, newValue) => ({
    depName: "node",
    manager: "dockerfile",
    packageFile: "docker/Dockerfile.server",
    currentValue,
    newValue,
});

describe("entries", () => {
    it("names an image by its version, without the flavour of the tag", () => {
        assert.deepEqual(entries([nodeImage("22-bookworm-slim", "24-bookworm-slim")]).items, [
            { name: "node", image: true, from: "22", to: "24" },
        ]);
    });

    it("lists a dependency updated in several files once", () => {
        const { items } = entries([
            nodeImage("22-bookworm", "24-bookworm"),
            nodeImage("22-bookworm-slim", "24-bookworm-slim"),
        ]);
        assert.equal(items.length, 1);
    });

    it("falls back to the range when no version is known", () => {
        const { items } = entries([{ depName: "lit", manager: "npm", depType: "dependencies", currentValue: "^3.2.0", newValue: "^3.3.0" }]);
        assert.deepEqual(items[0], { name: "lit", image: false, from: "^3.2.0", to: "^3.3.0" });
    });

    it("leaves out what does not reach the running system", () => {
        const { items } = entries([
            nodeImage("22-bookworm", "24-bookworm"),
            { depName: "node", manager: "nvm", currentValue: "22", newValue: "24" },
            { depName: "@types/node", manager: "npm", depType: "devDependencies", currentVersion: "22.0.0", newVersion: "24.0.0" },
            { ...nodeImage("22-bookworm", "24-bookworm"), packageFile: "docker/Dockerfile.server.dev" },
        ]);
        assert.deepEqual(items, [{ name: "node", image: true, from: "22", to: "24" }]);
    });

    it("recognises the lock file maintenance", () => {
        assert.deepEqual(entries([{ updateType: "lockFileMaintenance", manager: "npm" }]), { items: [], lockFile: true });
    });
});

describe("updateNotes", () => {
    it("opens the section below the template", () => {
        assert.equal(
            updateNotes(TEMPLATE, [fastify]),
            `${TEMPLATE}\n${HEADING}\n\n- \`fastify\` 5.6.1 → 5.7.0\n`,
        );
    });

    it("puts the section below what was written by hand", () => {
        const text = `${TEMPLATE}\n### Something new\n\nIt is new.\n`;
        assert.equal(
            updateNotes(text, [fastify]),
            `${TEMPLATE}\n### Something new\n\nIt is new.\n\n${HEADING}\n\n- \`fastify\` 5.6.1 → 5.7.0\n`,
        );
    });

    it("adds to a section that exists, also when text follows it", () => {
        const text = `${HEADING}\n\n- \`fastify\` 5.6.1 → 5.7.0\n\n### Later\n\nWritten afterwards.\n`;
        assert.equal(
            updateNotes(text, [nodeImage("22-bookworm", "24-bookworm")]),
            `${HEADING}\n\n- \`fastify\` 5.6.1 → 5.7.0\n- \`node\` image 22 → 24\n\n### Later\n\nWritten afterwards.\n`,
        );
    });

    it("keeps where a dependency came from and takes its new target", () => {
        const text = `${HEADING}\n\n- \`fastify\` 5.6.1 → 5.7.0\n`;
        const later = { ...fastify, currentVersion: "5.7.0", newVersion: "5.8.0" };
        assert.equal(updateNotes(text, [later]), `${HEADING}\n\n- \`fastify\` 5.6.1 → 5.8.0\n`);
    });

    it("tells an image from an npm package of the same name", () => {
        const text = `${HEADING}\n\n- \`node\` image 22 → 24\n`;
        const npmNode = { depName: "node", manager: "npm", depType: "dependencies", currentVersion: "1.0.0", newVersion: "1.1.0" };
        assert.equal(
            updateNotes(text, [npmNode]),
            `${HEADING}\n\n- \`node\` image 22 → 24\n- \`node\` 1.0.0 → 1.1.0\n`,
        );
    });

    it("gives the same notes when it runs twice", () => {
        const once = updateNotes(TEMPLATE, [fastify, { updateType: "lockFileMaintenance" }]);
        assert.equal(updateNotes(once, [fastify, { updateType: "lockFileMaintenance" }]), once);
    });

    it("notes the lock file maintenance once", () => {
        const once = updateNotes(TEMPLATE, [{ updateType: "lockFileMaintenance" }]);
        assert.equal(once, `${TEMPLATE}\n${HEADING}\n\n${LOCK_LINE}\n`);
        assert.equal(updateNotes(once, [{ updateType: "lockFileMaintenance" }]), once);
    });

    it("fills a heading that has text but no list yet", () => {
        assert.equal(
            updateNotes(`${HEADING}\nA word first.\n`, [fastify]),
            `${HEADING}\n\n- \`fastify\` 5.6.1 → 5.7.0\n\nA word first.\n`,
        );
    });

    it("leaves the file alone when nothing changes a version", () => {
        assert.equal(updateNotes(TEMPLATE, [{ ...fastify, newVersion: "5.6.1" }]), TEMPLATE);
    });
});

describe("as a postUpgradeTask", () => {
    const script = fileURLToPath(new URL("./release-note.mjs", import.meta.url));

    function run(cwd, upgrades) {
        const dataFile = join(cwd, "data.json");
        writeFileSync(dataFile, JSON.stringify(upgrades));
        return execFileSync("node", [script], {
            cwd,
            env: { ...process.env, RENOVATE_POST_UPGRADE_COMMAND_DATA_FILE: dataFile },
            encoding: "utf8",
        });
    }

    it("writes .release/next.md", () => {
        const cwd = mkdtempSync(join(tmpdir(), "release-note-"));
        mkdirSync(join(cwd, ".release"));
        writeFileSync(join(cwd, ".release/next.md"), TEMPLATE);
        run(cwd, [fastify]);
        assert.match(readFileSync(join(cwd, ".release/next.md"), "utf8"), /- `fastify` 5\.6\.1 → 5\.7\.0/);
    });

    it("does nothing in a repository without release notes", () => {
        const cwd = mkdtempSync(join(tmpdir(), "release-note-"));
        assert.match(run(cwd, [fastify]), /does not exist/);
    });
});
