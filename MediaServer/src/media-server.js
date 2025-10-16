const path = require("path"), fs = require("fs"),
    http = require("http"), crypto = require("crypto"), helpers = require("./helpers")

const indexPageTemplate = fs.readFileSync("./templates/index.html", "utf-8")

class FileType {
    /** @param {string} extension @param {string} mimetype @param {boolean} playable */
    constructor(extension, mimetype, playable = true) {
        this.extension = extension
        this.mimetype = mimetype
        this.playable = playable
        this.extregex = new RegExp(`\.(?:${this.extension.replaceAll(".", "")})$`, "i")
    }

    /** @param {string} path @returns {FileType | undefined} */
    static find(path) {
        return FileType.All.find(ft => ft.extregex.test(path))
    }

    /** @type {FileType[]} */ static All = [
        new FileType(".mp4", "video/mp4"),
        new FileType(".mov", "video/mov"),
        new FileType(".webm", "video/webm"),
        new FileType(".avi", "video/x-msvideo", false),
        new FileType(".flv", "video/x-flv", false),
        new FileType(".mkv", "video/x-matroska", false),
        new FileType(".mp3", "audio/mpeg"),
        new FileType(".flac", "audio/flac")]
}

class FileData {
    /** @param {FileGroup} filegroup @param {string} fullpath @param {string} rootdir */
    constructor(filegroup, fullpath, rootdir) {
        this.filegroup = filegroup
        this.fullpath = fullpath
        this.filename = path.basename(this.fullpath)
        this.findpath = path.relative(rootdir, this.fullpath)
        this.filetype = FileType.find(this.findpath)
        this.filecode = crypto.createHash("MD5").update(this.fullpath).digest("hex").substring(0, 16)
    }
}

class FileGroup {
    /** @type {Object.<string, FileData>} */ files = {}
    /** @type {number} */ length = 0

    /** @param {string} name @param {boolean} enabled @param {string[]} roots */
    constructor(name, enabled, roots) {
        this.name = name
        this.code = crypto.createHash("MD5").update(this.name).digest("hex").substring(0, 8)
        this.enabled = enabled
        this.roots = roots
    }

    /** @type {FileGroup[]} */ static All = []
    static FilesTotal = 0
    static LoadDate = 0

    static loadAll() {
        FileGroup.loadAllAsync()
            .then(function () {
                console.log(`Files cached: ${FileGroup.FilesTotal} files in ${FileGroup.All.length} groups`)
            })
            .catch(function (err) {
                console.log("Files caching error:", err)
            })
    }

    static async loadAllAsync() {
        const filter = helpers.createExtensionsFilter(FileType.All.map(ft => ft.extension))
        for (let group of FileGroup.All) {
            const groupfd = []
            for (let root of group.roots) {
                const files = await helpers.findFilesAsync(root, filter)
                groupfd.push(...files.map(fp => new FileData(group, fp, root)))
            }
            group.length = groupfd.length
            for(let fc in group.files) {
                delete group.files[fc]
            }
            for (let fd of groupfd) {
                group.files[fd.filecode] = fd
            }
        }
        FileGroup.FilesTotal =  FileGroup.All.reduce((acc, fg) => acc + fg.length, 0)
        FileGroup.LoadDate = Date.now()
    }

    static get FilesUpdateAvailable() {
        return Date.now() - FileGroup.LoadDate > 5 * 60000;
    }
}

class SessionData {
    /** @type {FileData[]} */ filtered = []
    /** @type {string} */ filter = "*"
    /** @type {boolean} */ shownp = false

    /** @param {string} sessionid */
    constructor(sessionid) {
        this.sessionid = sessionid
        this.groups = FileGroup.All.filter(fg => fg.enabled)
    }

    /** @type {Object.<string, SessionData>} */ static All = {}

    /** @param {string} sessionid @returns {SessionData} */
    static findOrCreate(sessionid) {
        return SessionData.All[sessionid]
            ?? (SessionData.All[sessionid] = new SessionData(sessionid))
    }

    /** @param {boolean} newshownp @param {string} newfilter @param {FileGroup[]} newgroups */
    updateFilter(newshownp, newfilter, newgroups) {
        this.shownp = newshownp
        this.filter = newfilter
        this.groups = newgroups
        this.filtered.length = 0
        if (this.filter) {
            const regex = new RegExp(
                this.filter.replace(/[\u0000-\u001F\u007F-\u009F\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, "")
                    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replaceAll("\\?", ".").replaceAll("\\*", ".*"), "i")
            for (let group of this.groups) {
                for(let fc in group.files) {
                    const fd = group.files[fc]
                    if ((this.shownp || fd.filetype.playable) && regex.test(fd.findpath))
                        this.filtered.push(fd)
                }
            }
        }
    }
}

/** @param {http.IncomingMessage} req @param {http.ServerResponse<http.IncomingMessage>} res @param {FileData} filedata */
function streamFile(req, res, filedata) {
    const stat = fs.statSync(filedata.fullpath)
    const total = stat.size

    if (req.headers.range) {
        var range = req.headers.range
        var parts = range.replace(/bytes=/, "").split("-")
        var partialstart = parts[0]
        var partialend = parts[1]

        var start = parseInt(partialstart, 10)
        var end = partialend ? parseInt(partialend, 10) : total - 1
        var chunksize = (end-start) + 1
        // console.log(`RANGE: ${start} - ${end} = ${chunksize}`)
        var file = fs.createReadStream(filedata.fullpath, {start: start, end: end})
        res.writeHead(206, { "Content-Range": `bytes ${start}-${end}/${total}`,
            "Accept-Ranges": "bytes", "Content-Length": chunksize, "Content-Type": filedata.filetype.mimetype })
        file.pipe(res)
    }
    else {
        res.writeHead(200, { "Accept-Ranges": "bytes", "Content-Length": total, "Content-Type": filedata.filetype.mimetype })
        fs.createReadStream(filedata.fullpath).pipe(res)
    }
}

/** @param {string|undefined} str @returns {Object.<string, string>} */
function decodeArgumentString(str) {
    const args = {}
    for (let p of (str ?? "").matchAll(/([\w-]+)=([^&\r\n]*)[&\r\n]*/g))
        args[p[1]] = p[2]
    return args
}

/** @param {http.IncomingMessage} req @return {[string, string]} */
function extractUrlAndArgs(req) {
    const [url, enc] = decodeURIComponent(req.url).split('?')
    return [url, decodeArgumentString(enc)]
}

/** @param {http.IncomingMessage} req @param {http.ServerResponse<http.IncomingMessage>} res @return {string} */
function provideSessionID(req, res) {
    let sessid = /(?:sessid=)([0-9a-fA-F]{32})/.exec(req.headers?.cookie)
    if (sessid) {
        sessid = sessid[1]
    }
    if(sessid === null) {
        sessid = crypto.randomBytes(16).toString("hex")
        res.setHeader("Set-Cookie", "sessid=" + sessid)
    }
    return sessid
}

/** @param {http.IncomingMessage} req @param {http.ServerResponse<http.IncomingMessage>} res */
function handleRequest (req, res) {
    const [url, urlargs] = extractUrlAndArgs(req)
    const sessid = provideSessionID(req, res)
    const session = SessionData.findOrCreate(sessid)

    if (url === "/" && req.method === "POST") {
        let body = ""
        const tmr = setTimeout(() => reject(), 250)
        req.on("data", ch => body += ch.toString())
        req.on("end", () => {
            clearTimeout(tmr)
            const args = decodeArgumentString(decodeURIComponent(body))
            if (args?.plancacheupdate == "on" && FileGroup.FilesUpdateAvailable) {
                console.log("Caching files...")
                FileGroup.loadAll()
                console.log(`Files cached: ${FileGroup.FilesTotal}`)
            }
            const shownp = args?.shownonplayable == "on"
            const filter = args?.filter ?? session.filter
            const groups = FileGroup.All.filter((fg, ix) => args["filegroup" + ix] == "on")
            session.updateFilter(shownp, filter, groups)
            res.writeHead(301, { "Location": "/" }).end()
        })
    }
    else if (url === "/" && req.method === "GET") {
        const html = indexPageTemplate.replaceAll("{TITLE}", title)
            .replace("{SHOWNP}", session.shownp ? "checked " : "")
            .replace("{PCACHE}", FileGroup.FilesUpdateAvailable ? "" : "disabled ")
            .replace("{FILTER}", session.filter.replaceAll("\"", "&quot;"))
            .replace("{FOUND}", `${session.filtered.length > 0 ? session.filtered.length : "No"} files found`)
            .replace("{GROUPS}", FileGroup.All.map((fg, ix) =>
                `<div><input type="checkbox" name="filegroup${ix}"${session.groups.includes(fg) ? " checked" : ""} /><label> ${fg.name} (${fg.length} files)</label></div>`).join("\n"))
            .replace("{FILES}", session.filtered.map(fd =>
                `<a ${fd.filetype.playable ? "" : "class=\"nonplayable\" "}href="/stream-${fd.filegroup.code}${fd.filecode}">&bull; ${fd.filename}</a>`).join("\n"))
            res.writeHead(200, { "Accept-Ranges": "bytes" }).end(html)
    }
    else if (url.startsWith("/stream-") && req.method === "GET") {
        const match = url.match(/^\/stream-([a-f\d]{8})([a-f\d]{16})$/i)
        const filedata = match ? FileGroup.All.find(fg => fg.code === match[1])?.files[match[2]] : undefined
        if (filedata) {
            try {
                streamFile(req, res, filedata)
                console.log(req.socket.remoteAddress, "->", filedata.filename, req.url, req.headers?.range ?? "")
            }
            catch (err) {
                res.writeHead(500, "Internal Server Error").end()
                console.log(req.socket.remoteAddress, "STREAMING FILE FAILED ->", filedata.filename, req.url, err)
            }
        } else res.writeHead(404, "Not Found").end()
    }
    else {
        res.writeHead(404, "Not Found").end()
        if (url != "/favicon.ico")
            console.log(req.socket.remoteAddress, "-> Unknown url:", url)
    }
}

/** @param {string} name @param {string[]} roots @param {boolean} [enabled=false] */
function createGroup(name, roots, enabled = false) {
    FileGroup.All.push(new FileGroup(name, enabled, roots))
}

/** @param {string} host @param {number} port @param {string} title */
function startServer(host, port, title) {
    global.host = host
    global.port = port
    global.title = title
    FileGroup.loadAll()
    http.createServer(handleRequest).listen(port, host)
    console.log(`Server '${title}' running at http://${host}:${port}`)        
}

module.exports = {
    createGroup : createGroup,
    startServer : startServer
}
