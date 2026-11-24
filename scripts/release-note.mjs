#!/usr/bin/env node
// Writes what a Renovate update changes in the running system into the
// hand-written notes of the next release, .release/next.md (see
// stefgo/release-workflows). Without a line there a release is refused, so an
// update of the image or of a runtime dependency could not be released on its
// own.
//
// Runs as a postUpgradeTask of the runtime rule in default.json, inside the
// cloned repository, before Renovate commits. The updates of the branch arrive
// as JSON in the file RENOVATE_POST_UPGRADE_COMMAND_DATA_FILE names. Plain Node,
// nothing to install: it runs in the Renovate container.
//
// The result does not depend on how often it runs, so a branch that Renovate
// builds again on a newer base gets the same notes.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const NOTES_FILE = ".release/next.md";
export const HEADING = "### Dependency updates";
export const LOCK_LINE = "- Locked dependencies refreshed to the newest versions their ranges allow";

const ITEM = /^- `([^`]+)`( image)? (\S+) → (\S+)$/;

// An image is named by its tag, as the Dockerfile has it, without the flavour:
// "22-bookworm-slim" -> "22". Its version is what the tag pointed to on the
// day of the lookup (22.23.5), which the Dockerfile does not pin. An npm update
// names the installed version; the range ("^5.6.1") is the fallback.
function version(upgrade, side) {
    const value = upgrade[`${side}Value`] || "";
    if (upgrade.manager === "dockerfile") return value.split("-")[0];
    return upgrade[`${side}Version`] || value;
}

// The condition of the runtime rule in default.json, once more: the data file
// holds every update of the branch, and a branch may mix -- the Node major
// carries the image next to .nvmrc and @types/node, which only CI and the
// editor see.
export function isRuntime({ manager, depType, packageFile = "", updateType }) {
    return (
        updateType === "lockFileMaintenance" ||
        (manager === "npm" && depType === "dependencies") ||
        (manager === "dockerfile" && !packageFile.includes(".dev"))
    );
}

// One entry per dependency: node in four FROM lines is one update. The first
// upgrade names the version it comes from, the last the one it goes to.
export function entries(upgrades) {
    const byKey = new Map();
    let lockFile = false;
    for (const upgrade of upgrades.filter(isRuntime)) {
        if (upgrade.updateType === "lockFileMaintenance") {
            lockFile = true;
            continue;
        }
        if (!upgrade.depName) continue;
        const image = upgrade.manager === "dockerfile";
        const key = `${upgrade.depName}${image ? " image" : ""}`;
        const from = version(upgrade, "current");
        const to = version(upgrade, "new");
        if (!from || !to || from === to) continue;
        const known = byKey.get(key);
        byKey.set(key, { name: upgrade.depName, image, from: known ? known.from : from, to });
    }
    return { items: [...byKey.values()], lockFile };
}

function line({ name, image, from, to }) {
    return `- \`${name}\`${image ? " image" : ""} ${from} → ${to}`;
}

// Adds the updates to the section, or opens the section at the end. A
// dependency listed already (an update of an earlier week) keeps the version
// it came from and takes the new target, so the list does not grow until the
// next release empties the file.
export function updateNotes(text, upgrades) {
    const { items, lockFile } = entries(upgrades);
    if (items.length === 0 && !lockFile) return text;

    const lines = text.replace(/\s+$/, "").split("\n");
    let heading = lines.findIndex((l) => l.trim() === HEADING);
    if (heading === -1) {
        lines.push("", HEADING, "");
        heading = lines.length - 2;
    }

    // The list is the run of "- " lines below the heading, after blank lines.
    let start = heading + 1;
    while (start < lines.length && lines[start].trim() === "") start++;
    let end = start;
    while (end < lines.length && lines[end].startsWith("- ")) end++;
    const list = lines.slice(start, end);

    for (const item of items) {
        const at = list.findIndex((l) => {
            const m = ITEM.exec(l);
            return m && m[1] === item.name && Boolean(m[2]) === item.image;
        });
        if (at === -1) {
            list.push(line(item));
        } else {
            list[at] = line({ ...item, from: ITEM.exec(list[at])[3] });
        }
    }
    if (lockFile && !list.includes(LOCK_LINE)) list.push(LOCK_LINE);

    // A heading followed by text and no list gets a blank line on both sides.
    const after = lines.slice(end);
    const tail = end === start && after.length > 0 ? ["", ...after] : after;
    return `${[...lines.slice(0, heading + 1), "", ...list, ...tail].join("\n")}\n`;
}

function main() {
    const dataFile = process.env.RENOVATE_POST_UPGRADE_COMMAND_DATA_FILE;
    if (!dataFile) {
        console.error("RENOVATE_POST_UPGRADE_COMMAND_DATA_FILE is not set; run this as a Renovate postUpgradeTask with a dataFileTemplate.");
        process.exit(1);
    }
    if (!existsSync(NOTES_FILE)) {
        console.log(`${NOTES_FILE} does not exist; nothing to note.`);
        return;
    }
    const upgrades = JSON.parse(readFileSync(dataFile, "utf8"));
    const before = readFileSync(NOTES_FILE, "utf8");
    const after = updateNotes(before, upgrades);
    if (after === before) {
        console.log(`Nothing new for ${NOTES_FILE}: no runtime update in this branch, or noted already.`);
        return;
    }
    writeFileSync(NOTES_FILE, after);
    console.log(`Noted the update in ${NOTES_FILE}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
