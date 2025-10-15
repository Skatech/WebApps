"use strict"
const ms = require("./src/media-server.js")

ms.createGroup("Music", ["D:/Media/Music", "D:/Media/MusicNew"]) // two roots
ms.createGroup("Clips", ["D:/Media/Video/Clips"], true) // active by default
ms.createGroup("Films", ["D:/Media/Video/Films"], true) // active by default
ms.createGroup("Anime", ["//MyServer/Shared/Video/Anime"]) // network share root
ms.startServer("0.0.0.0", 8080, "My Home Media")
