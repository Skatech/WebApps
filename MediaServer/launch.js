"use strict"
const ms = require("./src/media-server.js")

ms.createGroup("Music", "audio", ["D:/Media/Music", "D:/Media/MusicNew"]) // two roots
ms.createGroup("Clips", "video", ["D:/Media/Video/Clips"], true) // active by default
ms.createGroup("Films", "video", ["D:/Media/Video/Films"], true) // active by default
ms.createGroup("Anime", "video", ["//MyServer/Shared/Video/Anime"]) // network share root

ms.createIdent("John", "12345") // credentials to access from WAN and update cache rights
ms.createIdent("Jane", "678")

ms.startServer("0.0.0.0", 8080, "My Home Media")
