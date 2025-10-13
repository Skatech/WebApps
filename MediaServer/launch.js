"use strict"
const ms = require("./src/media-server.js")

ms.createGroup("Music", ["D:/Media/Music", "//MyServer/Shared/Music"])
ms.createGroup("Clips", ["D:/Media/Video/Clips"], true)
ms.createGroup("Films", ["D:/Media/Video/Films"])
ms.createGroup("Anime", ["D:/Media/Video/Anime"])
ms.startServer("0.0.0.0", 8080, "My Home Media")
