"use strict"
const path = require("path"), fs = require("fs"), util = require("util")

const readdirAsync = util.promisify(fs.readdir)
const lstatAsync = util.promisify(fs.lstat)

/** @param {string} directory @param {RegExp} filter @returns {Promise<string[]>} */
async function findFilesAsync(directory, filter) {
    const files = [], directories = []
    for (let entry of await readdirAsync(directory)) {
        const stats = await lstatAsync(entry = path.join(directory, entry))
        if (stats.isDirectory()) {
            directories.push(...await findFilesAsync(entry, filter))
        }
        else if (filter?.test(entry) ?? true)
            files.push(entry)
    }
    files.push(...directories)
    return files
}

/** @param {string[]} extensions @return {RegExp} */
function createExtensionsFilter(extensions) {
    return new RegExp(`\.(?:${extensions.join("|").replaceAll(".", "")})$`, "i")
}

module.exports = {
    findFilesAsync : findFilesAsync,
    createExtensionsFilter : createExtensionsFilter
}
