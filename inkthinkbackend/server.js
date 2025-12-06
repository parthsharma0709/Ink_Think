import express from "express";
import "dotenv/config"
import cors from "cors";
import {createServer} from "http";
import { initSocketIO } from "./socket/index.js";

//app config
const app = express();
const port = process.env.PORT || 4000;

// middlewares
app.use(cors());
app.use(express.json());

// Create a raw http server and attaching the express application to it
const httpServer = createServer(app); 
// Initialise the socket.io connection
initSocketIO(httpServer);

// Start Sever
httpServer.listen(port,() => {
console.log("Server Started at port ",port);
});