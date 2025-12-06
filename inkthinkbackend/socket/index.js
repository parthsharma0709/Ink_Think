// Entry point for socket.io backend part
import { Server, Socket } from "socket.io";
import roomHandler from "./roomHandler.js";
import {gameHandler} from "./gameHandler.js";

let io; //we will export this later if needed

// socket.io is designed to work alongside a normal http server, http server is used for fallbacks and the initial handshake after which a normal http connection is upgraded to a websocket connection
const initSocketIO = (httpServer) => {
    io = new Server(httpServer, {
        cors : {
            origin : "*",
            methods : ["GET","POST"]
        }
    } );

    io.on("connection", (socket) => {
        console.log("New Client connected", socket.id);

        // Attach room related listeners to this socket
        roomHandler(io,socket);
        // Attach game related listeners to this socket
        gameHandler(io,socket);

        // Handle disconnects
        socket.on("disconnect", () => {
            console.log("Client disconnected", socket.id)
        } )

    } )

    return io;
};

export {initSocketIO};