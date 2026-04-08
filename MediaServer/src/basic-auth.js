"use strict"
const http = require("http")

/** @typedef {Object} Credentials @property {string} username @property {string} password */

/** @param {http.ServerResponse<http.IncomingMessage>} res @param {string} realm @param {string} message */
function setAuthenticateHeader(res, realm, message = "Authentication required") {
    res.setHeader("WWW-Authenticate", `Basic realm="${realm}"`)
    res.writeHead(401, message)
}

/** @param {http.IncomingMessage} req @returns {Credentials | undefined} */
function getAuthorizationData(req) {
    if (req.headers.authorization?.startsWith("Basic ")) {
        const [username, password] = Buffer.from(
            req.headers.authorization.split(" ")[1], "base64").toString("utf-8").split(":")
        return { username, password }
    }
}

/** @param {http.IncomingMessage} req @param {Credentials[] | Object.<string, Credentials} credentials @returns {Credentials | undefined} */
function tryAuthorize(req, credentials) {
    const ad = getAuthorizationData(req)
    return ad ? (Array.isArray(credentials) ? credentials : Object.values(credentials))
        .find(v => v.username === ad.username && v.password === ad.password) : undefined
}

module.exports = {
    setAuthenticateHeader,
    getAuthorizationData,
    tryAuthorize
}
