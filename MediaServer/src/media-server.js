const path = require("path"), fs = require("fs"),
    http = require("http"), crypto = require("crypto")

class FileType {
    /** @param {string} extension @param {string} mimetype @param {boolean} playable */
    constructor(extension, mimetype, playable = true) {
        this.extension = extension
        this.mimetype = mimetype
        this.playable = playable
    }

    /** @param {string} pathlow @returns {FileType | undefined} */
    static find(pathlow) {
        return FileType.All.find(ft => pathlow.endsWith(ft.extension))
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
    /** @param {FileGroup} filegroup @param {number} fileindex @param {string} fullpath @param {string} rootdir */
    constructor(filegroup, fileindex, fullpath, rootdir) {
        this.filegroup = filegroup
        this.fileindex = fileindex
        this.fullpath = fullpath
        this.filename = path.basename(this.fullpath)
        this.findpath = path.relative(rootdir, this.fullpath)
        this.filetype = FileType.find(this.findpath)
    }
}

class FileGroup {
    /** @type {FileData[]} */ files = []

    /** @param {string} name @param {boolean} enabled @param {string[]} roots */
    constructor(name, enabled, roots) {
        this.name = name
        this.enabled = enabled
        this.roots = roots
    }

    /** @type {FileGroup[]} */ static All = []
    static FilesTotal = 0

    static loadAll() {
        /** @param {string} dir @param {undefined | string[]} files @return {string[]} */
        function getAllFiles (dir, files) {
            files = files || []
            const records = fs.readdirSync(dir)
            for (let r in records) {
                const name = dir + '/' + records[r]
                if (fs.statSync(name).isDirectory()) {
                    getAllFiles(name, files)
                }
                else {
                    files.push(name)
                }
            }
            return files
        }

        for (let group of FileGroup.All) {
            for (let root of group.roots) {
                for (let fd of getAllFiles(root).map(fp => new FileData(group, -1, fp, root)).filter(fd => fd.filetype)) {
                    fd.fileindex = group.files.length
                    group.files.push(fd)
                }
            }
            this.FilesTotal += group.files.length
        }
    }
}

class SessionData {
    /** @type {FileData[]} */ filtered = []
    /** @type {string} */ filter = ""

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

    /** @param {string} newfilter @param {FileGroup[]} newgroups */
    updateFilter(newfilter, newgroups) {
        this.filter = newfilter
        this.groups = newgroups
        this.filtered.length = 0
        if (this.filter) {
            const r = new RegExp(this.filter.replace(/[.*+?^${}()|[\]\\]/g,
                    '\\$&').replaceAll("\\?", ".").replaceAll("\\*", ".*"), "i")
            for (let group of this.groups) {
                for (let file of group.files) {
                    if (r.test(file.findpath))
                        this.filtered.push(file)
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

    if (url === "/" && req.method === "GET") {
        const html = indexPageTemplate.replaceAll("{TITLE}", title)
            .replace("{FILTER}", session.filter.replaceAll("\"", "&quot;"))
            .replace("{GROUPS}", FileGroup.All.map((fg, ix) =>
                `<div><input type="checkbox" name="filegroup${ix}"${session.groups.includes(fg) ? " checked" : ""} /><label> ${fg.name} (${fg.files.length} files)</label></div>`).join("\n"))
            .replace("{FILES}", session.filtered.length < 1 ? "No files found" : session.filtered.map((fd, ix) =>
                `<a ${fd.filetype.playable ? "" : "class=\"nonplayable\" "}href="/stream${ix}">${fd.filename}</a><br>`).join("\n"))
            res.writeHead(200, { "Accept-Ranges": "bytes" }).end(html)
    }
    else if (url === "/" && req.method === "POST") {
        let body = ""
        const tmr = setTimeout(() => reject(), 250)
        req.on("data", ch => body += ch.toString())
        req.on("end", () => {
            clearTimeout(tmr)
            const args = decodeArgumentString(decodeURIComponent(body))
            const filter = args?.filter ?? session.filter
            const groups = FileGroup.All.filter((fg, ix) => args["filegroup" + ix] ? true : false)
            session.updateFilter(filter, groups)
            res.writeHead(301, { "Location": "/" }).end()
        })
    }
    else if (url.startsWith("/stream") && req.method === "GET") {
        const i = parseInt(url.substring(7))
        if (session.filtered.length > i) {
            const filedata = session.filtered[i]
            try {
                streamFile(req, res, filedata)
                console.log(req.socket.remoteAddress, "->", filedata.filename, req.url, req.headers?.range ?? "")
            }
            catch (err) {
                console.log(req.socket.remoteAddress, "STREAMING FILE FAILED ->", filedata.filename, req.url, err)
            }
        }
    }
    else {
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
    console.log("Caching files...")
    FileGroup.loadAll()
    console.log(`Files cached: ${FileGroup.FilesTotal}`)
    http.createServer(handleRequest).listen(port, host)
    console.log(`Server '${title}' running at http://${host}:${port}`)        
}

const indexPageTemplate = fs.readFileSync("./templates/index.html", "utf-8")

module.exports = {
    createGroup : createGroup,
    startServer : startServer
}
