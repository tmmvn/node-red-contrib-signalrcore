/**
 * Copyright JS Foundation and other contributors, http://js.foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 **/
module.exports = function(RED)
{
	"use strict";
	const signalR = require("@microsoft/signalr");
	// =======================
	// === SignalR Configuration/Connection node ===
	// =======================
	function SignalRClientNode(n)
	{
		// Create a RED node
		RED.nodes.createNode(
			this,
			n
		);
		var node = this;
		// Local copies of the node configuration (as defined in the .html)
		node.host = n.host;
		node.port = n.port;
		node.hub = n.hub;
		node.secure = n.secure;
		node.reconnectInterval = parseInt(n.reconnectInterval);
		node.auth = n.auth;
		if(node.reconnectInterval < 100)
		{
			node.reconnectInterval = 100;
		}
		var portLabel;
		if(node.secure)
		{
			if(node.port === "443")
			{
				portLabel = "";
			} else
			{
				portLabel = ":" + node.port;
			}
		} else
		{
			if(node.port === "80")
			{
				portLabel = "";
			} else
			{
				portLabel = ":" + node.port;
			}
		}
		var protocol;
		if(node.secure)
		{
			protocol = "https://";
		} else
		{
			protocol = "http://";
		}
		node.path = protocol + node.host + portLabel + "/" + node.hub;
		node.closing = false; // Used to check if node-red is closing, or not,
	                          // and if so decline any reconnect attempts.
		// Connect to remote endpoint
		function startconn()
		{
			node.closing = false;
			if(node.reconnectTimoutHandle)
			{
				clearTimeout(node.reconnectTimoutHandle);
			}
			node.reconnectTimoutHandle = null;
			if(node.auth)
			{
				console.log("Connecting with authentication");
				var connection = new signalR.HubConnectionBuilder()
					.withUrl(
						node.path,
						{
							accessTokenFactory: async() =>
							{
								try
								{
									var clientId = node.credentials.clientid;
									var clientSecret = node.credentials.clientsecret;
									var authUrl = node.credentials.authurl;
									console.log(
										"Authenticating to ",
										authUrl
									);
									const response = await fetch(
										authUrl,
										{
											method: "POST", headers: {
												"Content-Type": "application/x-www-form-urlencoded",
											}, body: new URLSearchParams({
												client_id: clientId,
												client_secret: clientSecret,
												grant_type: "client_credentials",
												scope: "pcc-hub.client",
											}),
										}
									);
									if(!response.ok)
									{
										throw new Error(`HTTP error! status: ${response.status}`,);
									}
									const data = await response.json();
									return data.access_token;
								}
								catch(error)
								{
									node.error("Error fetching access token: "
										+ error.toString(),);
									return Promise.reject(error);
								}
							},
							skipNegotiation: true,
							transport: signalR.HttpTransportType.WebSockets,
						}
					)
					.withAutomaticReconnect()
					.configureLogging(signalR.LogLevel.Information)
					.build();
			} else
			{
				console.log("Connecting without authentication");
				var connection = new signalR.HubConnectionBuilder()
					.withUrl(node.path)
					.configureLogging(signalR.LogLevel.Information)
					.build();
			}
			node.connection = connection; // keep for closing
			handleConnection(connection);
		}

		async function handleConnection(/*connection*/
			connection)
		{
			var id = "";

			function notifyOnError(err)
			{
				if(!err)
				{
					return;
				}
				node.emit(
					"erro",
					{
						err: err, id: id,
					}
				);
			}

			function reconnect()
			{
				if(node.reconnectTimoutHandle)
				{
					clearTimeout(node.reconnectTimoutHandle);
				}
				if(node.closing)
				{
					return;
				}
				node.reconnectTimoutHandle = setTimeout(
					() => startconn(),
					node.reconnectInterval,
				);
			}

			try
			{
				console.log("Starting connection...");
				await connection.start();
				if(connection.state != signalR.HubConnectionState.Connected)
				{
					throw new Error("Connection failed");
				}
				// We're connected
				console.log("Connected.");
				id = connection.connectionId;
				node.emit(
					"opened",
					{
						count: "", id: id,
					}
				);
				connection.onclose((err) =>
				{
					console.log("Connection closed.");
					node.emit(
						"closed",
						{
							count: "", id: id,
						}
					);
					notifyOnError(err);
					reconnect();
				});
				connection.onreconnecting((err) =>
				{
					console.log("Reconnecting...");
					node.emit(
						"reconnecting",
						{
							count: "", id: id,
						}
					);
					notifyOnError(err);
				});
				connection.onreconnected((err) =>
				{
					console.log("Reconnected.");
					node.emit(
						"reconnected",
						{
							count: "", id: id,
						}
					);
					notifyOnError(err);
				});
			}
			catch(err)
			{
				notifyOnError(err);
				reconnect();
			}
		}

		node.closing = false;
		startconn(); // start outbound connection
		node.on(
			"close",
			function(done)
			{
				node.closing = true;
				node.connection.stop().finally(() =>
				{
					if(node.reconnectTimoutHandle)
					{
						clearTimeout(node.reconnectTimoutHandle);
						node.reconnectTimoutHandle = null;
					}
					done();
				});
			}
		);
	}

	RED.nodes.registerType(
		"signalr-client",
		SignalRClientNode,
		{
			credentials: {
				authurl: {type: "text"},
				clientid: {type: "password"},
				clientsecret: {type: "password"},
			},
		}
	);
	// =======================
	// === SignalR In node ===
	// =======================
	function SignalRInNode(n)
	{
		RED.nodes.createNode(
			this,
			n
		);
		var node = this;
		node.client = n.client;
		node.responses = n.responses;
		node.connectionConfig = RED.nodes.getNode(this.client);
		if(!this.connectionConfig)
		{
			this.error(RED._("signalr.errors.missing-conf"));
			return;
		}
		this.connectionConfig.on(
			"opened",
			function(event)
			{
				node.status({
					fill: "green", shape: "dot", text: RED._(
						"signalr.status.connected",
						{
							count: event.count,
						}
					), event: "connect", _session: {
						type: "signalr", id: event.id,
					},
				});
				// send the connected msg
				node.send([
					{_connectionId: event.id, payload: "Connected"}, null, null,
				]);
				node.responses.forEach((
					response,
					index
				) =>
				{
					// subscribe to each methodName in configured responses
					node.connectionConfig.connection.on(
						response.methodName,
						(data) =>
						{
							// we're in a callback from the server
							var newMsg = {
								payload: data,
							};
							var knownMsgs = [null, null, null]; // make room
						                                        // for
						                                        // connected,
						                                        // errors, and
						                                        // disconnected
							for(
								let outputNumber = 0;
								outputNumber < node.responses.length;
								outputNumber++
							)
							{
								if(outputNumber === index)
								{
									// this is our msg output
									knownMsgs.push(newMsg);
								} else
								{
									knownMsgs.push(null);
								}
							}
							node.send(knownMsgs);
						},
					);
				});
			}
		);
		this.connectionConfig.on(
			"erro",
			function(event)
			{
				node.status({
					fill: "red",
					shape: "ring",
					text: RED._("node-red:common.status.error"),
					event: "error",
					_session: {
						type: "signalr", id: event.id,
					},
				});
				var errMsg = {payload: event.err};
				if(event.id)
				{
					errMsg._connectionId = event.id;
				}
				node.error(
					event.err,
					errMsg
				);
			}
		);
		this.connectionConfig.on(
			"closed",
			function(event)
			{
				var status;
				if(event.count > 0)
				{
					status = {
						fill: "green", shape: "dot", text: RED._(
							"signalr.status.connected",
							{
								count: event.count,
							}
						),
					};
				} else
				{
					status = {
						fill: "red",
						shape: "ring",
						text: RED._("node-red:common.status.disconnected"),
					};
				}
				status.event = "disconnect";
				status._session = {
					type: "signalr", id: event.id,
				};
				node.status(status);
				node.send([
					null, null,
					{_connectionId: event.id, payload: "Disconnected"},
				]);
			}
		);
		this.connectionConfig.on(
			"reconnecting",
			function(event)
			{
				node.status({
					fill: "yellow", shape: "dot", text: RED._(
						"signalr.status.reconnecting",
						{
							count: event.count,
						}
					), event: "reconnecting", _session: {
						type: "signalr", id: event.id,
					},
				});
			}
		);
		this.connectionConfig.on(
			"reconnected",
			function(event)
			{
				node.status({
					fill: "green", shape: "dot", text: RED._(
						"signalr.status.reconnected",
						{
							count: event.count,
						}
					), event: "reconnected", _session: {
						type: "signalr", id: event.id,
					},
				});
				// send the connected msg
				node.send([
					{_connectionId: event.id, payload: "Connected"}, null, null,
				]);
			}
		);
		this.on(
			"close",
			function(
				removed,
				done
			)
			{
				if(removed && node.connectionConfig)
				{
					node.connectionConfig.removeInputNode(node);
				} else
				{
					// This node is being restarted
				}
				node.status({});
				done();
			}
		);
	}

	RED.nodes.registerType(
		"signalr in",
		SignalRInNode
	);
	// =======================
	// === SignalR Out node ===
	// =======================
	function SignalROutNode(n)
	{
		RED.nodes.createNode(
			this,
			n
		);
		var node = this;
		node.client = n.client;
		node.connectionConfig = RED.nodes.getNode(this.client);
		if(!node.connectionConfig)
		{
			this.error(RED._("signalr.errors.missing-conf"));
			return;
		}
		node.connectionConfig.on(
			"opened",
			function(event)
			{
				node.status({
					fill: "green", shape: "dot", text: RED._(
						"signalr.status.connected",
						{
							count: event.count,
						}
					), event: "connect", _session: {
						type: "signalr", id: event.id,
					},
				});
			}
		);
		node.connectionConfig.on(
			"erro",
			function(event)
			{
				node.status({
					fill: "red",
					shape: "ring",
					text: RED._("node-red:common.status.error"),
					event: "error",
					_session: {
						type: "signalr", id: event.id,
					},
				});
			}
		);
		this.connectionConfig.on(
			"reconnecting",
			function(event)
			{
				node.status({
					fill: "yellow", shape: "dot", text: RED._(
						"signalr.status.reconnecting",
						{
							count: event.count,
						}
					), event: "reconnecting", _session: {
						type: "signalr", id: event.id,
					},
				});
			}
		);
		this.connectionConfig.on(
			"reconnected",
			function(event)
			{
				node.status({
					fill: "green", shape: "dot", text: RED._(
						"signalr.status.reconnected",
						{
							count: event.count,
						}
					), event: "reconnected", _session: {
						type: "signalr", id: event.id,
					},
				});
			}
		);
		node.connectionConfig.on(
			"closed",
			function(event)
			{
				var status;
				if(event.count > 0)
				{
					status = {
						fill: "green", shape: "dot", text: RED._(
							"signalr.status.connected",
							{
								count: event.count,
							}
						),
					};
				} else
				{
					status = {
						fill: "red",
						shape: "ring",
						text: RED._("node-red:common.status.disconnected"),
					};
				}
				status.event = "disconnect";
				status._session = {
					type: "signalr", id: event.id,
				};
				node.status(status);
			}
		);
		node.on(
			"input",
			function(
				msg,
				nodeSend,
				nodeDone
			)
			{
				var methodName = msg.topic;
				var payload = msg.payload;
				var connectionConfig = node.connectionConfig;
				if(!connectionConfig)
				{
					node.error(
						"Unable to find connection configuration",
						msg
					);
					if(nodeDone)
					{
						nodeDone();
					}
					return;
				}
				if(!methodName)
				{
					node.error(
						"Missing msg.topic",
						msg
					);
					if(nodeDone)
					{
						nodeDone();
					}
					return;
				}
				if(!payload)
				{
					node.error(
						"Missing msg.payload",
						msg
					);
					if(nodeDone)
					{
						nodeDone();
					}
					return;
				}
				if(!Array.isArray(payload))
				{
					node.error(
						"msg.payload must be an array",
						msg
					);
					if(nodeDone)
					{
						nodeDone();
					}
					return;
				}
				if(connectionConfig.connection.state
					!== signalR.HubConnectionState.Connected)
				{
					node.error(
						"Cannot send data if the connection is not in the 'Connected' State.",
						msg,
					);
					if(nodeDone)
					{
						nodeDone(new Error("Cannot send data if the connection is not in the 'Connected' State.",),);
					}
					return;
				}
				connectionConfig.connection
					.send(
						methodName,
						...payload
					)
					.then(() =>
					{
						if(nodeDone)
						{
							nodeDone();
						}
					})
					.catch((err) =>
					{
						node.error(
							"Error sending message: " + err.toString(),
							msg
						);
						if(nodeDone)
						{
							nodeDone(err);
						}
					});
			}
		);
		node.on(
			"close",
			function(done)
			{
				node.status({});
				done();
			}
		);
	}

	RED.nodes.registerType(
		"signalr out",
		SignalROutNode
	);
	// =======================
	// === SignalR Invoke node ===
	// =======================
	function SignalRInvokeNode(n)
	{
		RED.nodes.createNode(
			this,
			n
		);
		var node = this;
		node.client = n.client;
		node.connectionConfig = RED.nodes.getNode(this.client);
		if(!node.connectionConfig)
		{
			this.error(RED._("signalr.errors.missing-conf"));
			return;
		}
		node.connectionConfig.on(
			"opened",
			function(event)
			{
				node.status({
					fill: "green", shape: "dot", text: RED._(
						"signalr.status.connected",
						{
							count: event.count,
						}
					), event: "connect", _session: {
						type: "signalr", id: event.id,
					},
				});
			}
		);
		node.connectionConfig.on(
			"erro",
			function(event)
			{
				node.status({
					fill: "red",
					shape: "ring",
					text: RED._("node-red:common.status.error"),
					event: "error",
					_session: {
						type: "signalr", id: event.id,
					},
				});
			}
		);
		this.connectionConfig.on(
			"reconnecting",
			function(event)
			{
				node.status({
					fill: "yellow", shape: "dot", text: RED._(
						"signalr.status.reconnecting",
						{
							count: event.count,
						}
					), event: "reconnecting", _session: {
						type: "signalr", id: event.id,
					},
				});
			}
		);
		this.connectionConfig.on(
			"reconnected",
			function(event)
			{
				node.status({
					fill: "green", shape: "dot", text: RED._(
						"signalr.status.reconnected",
						{
							count: event.count,
						}
					), event: "reconnected", _session: {
						type: "signalr", id: event.id,
					},
				});
			}
		);
		node.connectionConfig.on(
			"closed",
			function(event)
			{
				var status;
				if(event.count > 0)
				{
					status = {
						fill: "green", shape: "dot", text: RED._(
							"signalr.status.connected",
							{
								count: event.count,
							}
						),
					};
				} else
				{
					status = {
						fill: "red",
						shape: "ring",
						text: RED._("node-red:common.status.disconnected"),
					};
				}
				status.event = "disconnect";
				status._session = {
					type: "signalr", id: event.id,
				};
				node.status(status);
			}
		);
		node.on(
			"input",
			function(
				msg,
				nodeSend,
				nodeDone
			)
			{
				var methodName = msg.topic;
				var payload = msg.payload;
				var connectionConfig = node.connectionConfig;
				if(!connectionConfig)
				{
					node.error(
						"Unable to find connection configuration",
						msg
					);
					if(nodeDone)
					{
						nodeDone();
					}
					return;
				}
				if(!methodName)
				{
					node.error(
						"Missing msg.topic",
						msg
					);
					if(nodeDone)
					{
						nodeDone();
					}
					return;
				}
				if(!payload)
				{
					node.error(
						"Missing msg.payload",
						msg
					);
					if(nodeDone)
					{
						nodeDone();
					}
					return;
				}
				if(!Array.isArray(payload))
				{
					node.error(
						"msg.payload must be an array",
						msg
					);
					if(nodeDone)
					{
						nodeDone();
					}
					return;
				}
				if(connectionConfig.connection.state
					!== signalR.HubConnectionState.Connected)
				{
					node.error(
						"Cannot send data if the connection is not in the 'Connected' State.",
						msg,
					);
					if(nodeDone)
					{
						nodeDone(new Error("Cannot send data if the connection is not in the 'Connected' State.",),);
					}
					return;
				}
				connectionConfig.connection
					.invoke(
						methodName,
						...payload
					)
					.then((res) =>
					{
						console.log(
							"Invoked. Response:",
							res
						);
						if(nodeDone)
						{
							nodeDone();
						}
					})
					.catch((err) =>
					{
						node.error(
							"Error sending message: " + err.toString(),
							msg
						);
						if(nodeDone)
						{
							nodeDone(err);
						}
					});
			}
		);
		node.on(
			"close",
			function(done)
			{
				node.status({});
				done();
			}
		);
	}

	RED.nodes.registerType(
		"signalr invoke",
		SignalRInvokeNode
	);
};
