(function (global, factory) {
  typeof exports === 'object' && typeof module !== 'undefined' ? factory(exports) :
  typeof define === 'function' && define.amd ? define(['exports'], factory) :
  (global = typeof globalThis !== 'undefined' ? globalThis : global || self, factory(global.kikxSdk = {}));
})(this, (function (exports) { 'use strict';

  class KikxConfig {
    constructor(config = {}) {
      const { apiUrl, wsUrl, appID } = config || {};

      this.customApiUrl = apiUrl;
      this.customWsUrl = wsUrl;
      this.customAppID = appID || window.location.pathname.split("/")[2] || null;
    }

    // Get AppID
    getAppID = () => this.customAppID;

    // Configure custom API URLs
    configureUrls(options = {}) {
      const { apiUrl, wsUrl, appID } = options;

      if (apiUrl) this.customApiUrl = apiUrl;
      if (wsUrl) this.customWsUrl = wsUrl;
      if (appID) this.customAppID = appID;
    }

    // Get default base URL
    getDefaultBase = () => {
      const { protocol, hostname, port } = window.location;
      return `${protocol}//${hostname}${port ? `:${port}` : ""}`;
    };

    // Get API URL
    getApiUrl = () => this.customApiUrl || this.getDefaultBase();

    // Get WebSocket URL
    getWsUrl = () => {
      if (this.customWsUrl) return this.customWsUrl;

      const { protocol, hostname, port } = window.location;
      return `${protocol === "https:" ? "wss:" : "ws:"}//${hostname}${port ? `:${port}` : ""}`;
    };

    // Get full API URL with endpoint
    getUrl = (end = "") => `${this.getApiUrl()}${end.startsWith("/") ? end : `/${end}`}`;
  }

  async function request(
    endpoint,
    {
      method = "GET",
      body = undefined,
      params = {},
      headers = {},
      ...options
    } = {}
  ) {
    try {
      const url = new URL(endpoint);

      if (params) {
        Object.entries(params).forEach(([key, value]) => {
          if (value !== undefined && value !== null) {
            url.searchParams.set(key, String(value));
          }
        });
      }

      const isFormData = body instanceof FormData;

      const response = await fetch(url, {
        method,
        headers: {
          // Only set Content-Type for non-FormData bodies
          ...(body !== undefined &&
            !isFormData && {
              "Content-Type": "application/json"
            }),
          ...headers
        },

        ...(body !== undefined && {
          body: isFormData ? body : JSON.stringify(body)
        }),

        ...options
      });

      // Handle empty responses
      if (response.status === 204) {
        return {
          data: null,
          error: null
        };
      }

      const contentType = response.headers.get("content-type") || "";
      let result;

      if (contentType.includes("application/json")) {
        result = await response.json();
      } else if (contentType.includes("text/")) {
        result = await response.text();
      } else {
        result = await response.blob();
      }

      if (!response.ok) {
        return {
          data: null,
          error: {
            status: response.status,
            message:
              result?.detail ||
              result?.message ||
              `Request failed with status ${response.status}`,
            detail: result?.detail
          }
        };
      }

      return {
        data: result,
        error: null,
        contentType
      };
    } catch (error) {
      return {
        data: null,
        error: {
          status: null,
          message: error.message
        }
      };
    }
  }

  class Service {
    constructor(app, name) {
      this.app = app;
      this.serviceName = name;
      this.baseURL = `/service/${this.serviceName}`;

      this._apiType = "request";
    }
    
    setRequestType() {
      this._apiType = "request";
    }

    setFetchType() {
      this._apiType = "fetch";
    }

    api = (...args) =>
      this._apiType === "request" ? this.request(...args) : this.fetch(...args);

    request = (
      endpoint,
      {
        method = "GET",
        body = undefined,
        params = {},
        headers = {},
        ...options
      } = {}
    ) => {
      Object.assign(headers, { "kikx-app-id": this.app.getAppID() });
      const url = this.app.getUrl(`${this.baseURL}/${endpoint}`);

      return request(url, {
        method,
        body,
        params,
        headers,
        ...options
      });
    };

    fetch = async (...args) => {
      const { data, error } = await this.request(...args);

      if (error) {
        throw new Error(error.detail || "Error fetching data");
      }

      return data;
    };

    health = () => this.fetch("health");
  }

  function generateUUID() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
      const r =
        (crypto.getRandomValues(new Uint8Array(1))[0] & 15) >>
        (c === "x" ? 0 : 4);
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  class SystemService extends Service {
    constructor(app) {
      super(app, "system");
    }

    // ----------------------------------------
    // App information
    // ----------------------------------------

    appInfo = () => this.request("info/app");

    getAppsList = (meta = false) =>
      this.request("info/apps-list", {
        params: { meta }
      });

    // ----------------------------------------
    // Sessions
    // ----------------------------------------

    sessionsInfo = () => this.request("info/sessions");

    closeSession = sessionID =>
      this.request("info/session-close", {
        params: {
          session_id: sessionID
        }
      });

    // ----------------------------------------
    // Alerts
    // ----------------------------------------

    _alert = payload =>
      this.request("alert", {
        method: "POST",
        body: payload
      });

    alert = (message, { type = "info", priority = "normal" } = {}) =>
      this._alert({
        message,
        type,
        priority
      });

    // ----------------------------------------
    // App lifecycle
    // ----------------------------------------

    closeApp = () => this.request("close-app");
  }

  class EventEmitter {
    constructor() {
      this.eventHandlers = new Map();
    }

    /**
     * Register an event handler.
     * @param {string} event
     * @param {Function} callback
     * @returns {Function} Unsubscribe function
     */
    on(event, callback) {
      if (typeof callback !== "function") {
        throw new TypeError("callback must be a function");
      }

      if (!this.eventHandlers.has(event)) {
        this.eventHandlers.set(event, new Set());
      }

      this.eventHandlers.get(event).add(callback);

      return () => this.off(event, callback);
    }

    /**
     * Register a handler that runs only once.
     * @param {string} event
     * @param {Function} callback
     * @returns {Function} Unsubscribe function
     */
    once(event, callback) {
      const wrapper = async data => {
        this.off(event, wrapper);
        return callback(data);
      };

      return this.on(event, wrapper);
    }

    /**
     * Remove an event handler.
     * @param {string} event
     * @param {Function} callback
     */
    off(event, callback) {
      const callbacks = this.eventHandlers.get(event);

      if (!callbacks) {
        return;
      }

      callbacks.delete(callback);

      if (callbacks.size === 0) {
        this.eventHandlers.delete(event);
      }
    }

    /**
     * Emit an event and wait for all handlers.
     * @param {string} event
     * @param {*} payload
     * @param {boolean} ignoreErrors
     */
    async emit(event, payload = null, ignoreErrors = true) {
      const callbacks = this.eventHandlers.get(event);

      if (!callbacks) {
        return;
      }

      // Snapshot prevents modification during iteration
      // from affecting the current emit cycle.
      for (const callback of [...callbacks]) {
        try {
          await callback(payload);
        } catch (error) {
          if (!ignoreErrors) {
            throw error;
          }
        }
      }
    }

    /**
     * Remove all handlers for an event.
     * If no event is supplied, remove everything.
     */
    removeAll(event) {
      if (event !== undefined) {
        this.eventHandlers.delete(event);
      } else {
        this.eventHandlers.clear();
      }
    }

    /**
     * Check whether an event has handlers.
     */
    has(event) {
      return this.eventHandlers.has(event);
    }

    /**
     * Get number of handlers for an event.
     */
    listenerCount(event) {
      return this.eventHandlers.get(event)?.size ?? 0;
    }
  }

  // ---------------------- Singleton state

  let instance = null;
  let instanceType = null;

  // ---------------------- Base App

  class KikxApp {
    constructor(config = {}) {
      this.config = new KikxConfig(config);
      this.system = new SystemService(this);

      // App full info
      this.info = null;

      // Events and Messages Handlers
      this._appEvents = new EventEmitter();
      this._messageEvents = new EventEmitter();

      // Message handler
      window.addEventListener("message", ({ data }) => {
        const { event, payload } = data ?? {};
        if (!event) return;

        this._messageEvents.emit(event, payload);
      });
    }

    // ---------------------- App

    // Get appID
    getAppID = () => this.config.getAppID();

    // Get app api url
    getUrl = end => this.config.getUrl(end);

    // Get app ws url
    getWsUrl = () => this.config.getWsUrl();

    // ---------------------- Message Events

    onMessage(event, callback) {
      return this._messageEvents.on(event, callback);
    }

    offMessage(event, callback) {
      this._messageEvents.off(event, callback);
    }

    onceMessage(event, callback) {
      return this._messageEvents.once(event, callback);
    }

    // ---------------------- App Events

    on(event, callback) {
      return this._appEvents.on(event, callback);
    }

    once(event, callback) {
      return this._appEvents.once(event, callback);
    }

    off(event, callback) {
      this._appEvents.off(event, callback);
    }

    // ---------------------- Start

    async _run() {
      const { data, error } = await this.system.appInfo();

      if (error) {
        throw new Error("Error fetching app info: " + error.detail);
      }

      await this._appEvents.emit("start", data, false);

      this.info = data;
    }

    async run(callback = null) {
      await this._run();

      if (typeof callback === "function") {
        callback(this.info);
      }
    }
  }

  // ---------------------- Client App

  class KikxAppClient extends KikxApp {
    constructor(config = {}) {
      super(config);

      this.ws = null;

      this.reconnectAttempts = 0;
      this.reconnectDelay = 1000;
      this._reconnectTimer = null;
      this.maxReconnectAttempts = 13;

      this.on("reconnected", () => {
        this.reconnectAttempts = 0;
      });

      // visibilitychange
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState !== "visible") return;

        if (!this.hasSocketState(WebSocket.OPEN)) {
          this._forceReconnect();
        }

        try {
          this.ws.send(JSON.stringify({ event: "app-ping", payload: {} }));
        } catch (_) {}
      });

      this.onMessage("CHECK_WS", () => {
        if (!this.hasSocketState(WebSocket.OPEN)) {
          this._forceReconnect();
        }
      });
    }

    _forceReconnect() {
      this._clearReconnectTimer();
      this.reconnectAttempts = 0;

      if (this.hasSocketState(WebSocket.CONNECTING, WebSocket.OPEN)) {
        this.ws.close();
        return;
      }

      this._connect();
    }

    hasSocketState(...states) {
      return !!this.ws && states.includes(this.ws.readyState);
    }

    // Connect app ws
    _connect() {
      if (this.hasSocketState(WebSocket.CONNECTING, WebSocket.OPEN)) {
        return;
      }

      const url = `${this.getWsUrl()}/app/${this.getAppID()}`;
      this.ws = new WebSocket(url);

      this.ws.onopen = e => {
        this._clearReconnectTimer();
        this._appEvents.emit("ws:open", e);
      };

      this.ws.onmessage = e => {
        let message;

        try {
          message = JSON.parse(e.data);
        } catch (err) {
          console.error("Invalid JSON", err);
          return;
        }

        this._appEvents.emit("ws:onmessage", e);

        const { event, payload } = message;

        if (event) {
          this._appEvents.emit(event, payload);
        }
      };

      this.ws.onclose = e => {
        this.ws = null;
        this._appEvents.emit("ws:onclose", e);
        this._scheduleReconnect();
      };

      this.ws.onerror = e => {
        this._appEvents.emit("ws:onerror", e);

        if (this.hasSocketState(WebSocket.CONNECTING, WebSocket.OPEN)) {
          this.ws.close();
        }
      };
    }

    _scheduleReconnect() {
      if (this._reconnectTimer) return;

      console.log("WS-Reconnecting...");

      if (this.reconnectAttempts >= this.maxReconnectAttempts) {
        console.log("WS-Reconecting failed!");
        this._appEvents.emit("ws:reconnect_failed");
        return;
      }

      this.reconnectAttempts += 1;

      this._reconnectTimer = setTimeout(() => {
        this._reconnectTimer = null;
        this._connect();
      }, this.reconnectDelay);
    }

    _clearReconnectTimer() {
      if (this._reconnectTimer) {
        clearTimeout(this._reconnectTimer);
        this._reconnectTimer = null;
      }
    }

    // Send JSON data to app using ws
    send(data) {
      if (this.hasSocketState(WebSocket.OPEN)) {
        this.ws.send(JSON.stringify(data));
      }
    }

    sendEvent(event, payload = null) {
      this.send({ event, payload });
    }

    async run(callback = null) {
      await this._run();

      if (typeof callback === "function") {
        this.once("connected", () => {
          callback(this.info);
        });
      }

      if (this.hasSocketState(WebSocket.CONNECTING, WebSocket.OPEN)) {
        return;
      }

      this._connect();
    }
  }

  // ---------------------- Create Base App

  function createKikxApp(config = null) {
    if (instance) {
      if (instanceType !== "base") {
        throw new Error(
          `KikxApp already created as '${instanceType}', cannot create 'base'.`
        );
      }

      return instance;
    }

    instanceType = "base";
    instance = new KikxApp(config);

    return instance;
  }

  // ---------------------- Create Client App

  function createKikxClient(config = null) {
    if (instance) {
      if (instanceType !== "client") {
        throw new Error(
          `KikxApp already created as '${instanceType}', cannot create 'client'.`
        );
      }

      return instance;
    }

    instanceType = "client";
    instance = new KikxAppClient(config);

    return instance;
  }

  // ---------------------- Get Existing Instance

  function getKikxApp() {
    if (!instance) {
      throw new Error(
        "KikxApp not created. Call createKikxApp() or createKikxClient() first."
      );
    }

    return instance;
  }

  class FileSystemService extends Service {
    constructor(app) {
      super(app, "fs");
    }

    // List files by limit & sorting -1 for all files
    listFiles = (
      directory,
      {
        offset = 0,
        limit = -1,
        sort = "name",
        asc = true,
        thumbnails = false
      } = {}
    ) =>
      this.api("list", {
        params: { directory, offset, limit, sort, asc, thumbnails }
      });

    // Get thumbnail
    thumbnail = filename =>
      this.api("thumbnail", {
        params: { filename }
      });

    // Read file
    readFile = filename =>
      this.api("read", {
        params: { filename }
      });

    // Write file
    writeFile = (filename, content, { mode = "write", ensureDir = false } = {}) =>
      this.api("write", {
        method: "POST",
        body: { filename, content, mode, ensure_dir: ensureDir }
      });

    // Append to file
    appendFile = (filename, content) =>
      this.writeFile(filename, content, { mode: "append" });

    // Delete file
    deleteFile = filename =>
      this.api("delete", {
        method: "DELETE",
        params: { filename }
      });

    // Upload file
    uploadFile = (file, dest) => {
      const formData = new FormData();
      formData.append("files", file);

      return this.api("upload", {
        method: "POST",
        body: formData,
        params: { dest }
      });
    };

    // Download file
    downloadFile = path =>
      this.api("download", {
        params: { path }
      });

    // Upload files
    uploadFiles = (files, dest) => {
      const formData = new FormData();

      files.forEach(file => formData.append("files", file));

      return this.api("upload", {
        method: "POST",
        body: formData,
        params: { dest }
      });
    };

    // Create File
    createFile = filename =>
      this.api("create_file", {
        method: "POST",
        body: { filename }
      });

    // Create directory
    createDirectory = dirname =>
      this.api("create_directory", {
        method: "POST",
        body: { dirname }
      });

    // Delete directory
    deleteDirectory = dirname =>
      this.api("delete_directory", {
        method: "DELETE",
        params: { dirname }
      });

    // Delete list
    deleteList = paths =>
      this.api("delete-list", {
        method: "POST",
        body: { paths }
      });

    // Rename
    rename = (source, new_name) =>
      this.api("rename", {
        method: "POST",
        body: { source, new_name }
      });

    // Info
    info = path =>
      this.api("info", {
        params: { path }
      });

    // Copy
    copy = (source, dest) =>
      this.api("copy", {
        method: "POST",
        body: { source, dest }
      });

    // Copy File
    copyFile = (source, dest, { override = false } = {}) =>
      this.request("copy-file", {
        method: "POST",
        body: { source, dest, override }
      });

    // Move
    move = (source, dest) =>
      this.api("move", {
        method: "POST",
        body: { source, dest }
      });

    // Expose path for serve files
    expose = (path, expires = null) =>
      this.api("expose", {
        method: "POST",
        body: { path, expires }
      });

    // Remove Expose
    removeExpose = uid =>
      this.api("expose", {
        method: "DELETE",
        params: { uid }
      });

    // Clear Expose
    clearExpose = () => this.api("clear-expose");

    // Get file url
    getServeUrl = (uid, path = "", absolute = false) => {
      const url = `${this.baseURL}/serve/${uid}/${encodeURIComponent(path)}`;

      return absolute ? this.app.getUrl(url) : url;
    };

    // Get full file url
    getServeAbsUrl = (uid, path = "") => this.getServeUrl(uid, path, true);

    // Get serve file
    getServeFile = (uid, path = "") =>
      this.api(`serve/${uid}/${encodeURIComponent(path)}`);
  }

  class ProxyService extends Service {
    constructor(app) {
      super(app, "proxy");
    }
    
    // Proxy Request non-cors blocking response
    proxyRequest = (
      url,
      {
        method = "GET",
        params = {},
        body = undefined,
        headers = {},
        ...options
      } = {}
    ) =>
      this.request("", {
        method,
        params: {
          __proxy_target: url,
          ...params
        },
        body,
        headers,
        ...options
      });
  }

  class KVService extends Service {
    constructor(app) {
      super(app, "kv");

      this.setFetchType();
    }

    // Get collection info
    info = () => this.api("info");

    // Dump data
    dump = () => this.api("dump");

    // Get value by key
    get = key =>
      this.api("get", {
        params: { key }
      });

    // Set key/value
    set = (key, value) =>
      this.api("set", {
        method: "POST",
        body: { key, value }
      });

    // Check if key exists
    exists = key =>
      this.api("exists", {
        params: { key }
      });

    // Get existing value or set default value
    getOrSet = (key, value) =>
      this.api("get-set", {
        method: "POST",
        body: { key, value }
      });

    // Remove and return value
    pop = key =>
      this.api("pop", {
        method: "DELETE",
        params: { key }
      });

    // Persist collection
    save = () =>
      this.api("save", {
        method: "POST"
      });

    // Reset collection
    reset = () =>
      this.api("reset", {
        method: "POST"
      });
  }

  // Runs functions in os service in backend
  class OSService extends Service {
    constructor(app) {
      super(app, "os");
    }

    // { data, error } result
    func = (name, { args = [], options = {} } = {}) =>
      this.request("run", {
        method: "POST",
        body: {
          name,
          args,
          options
        }
      });

    // Execute
    run = (name, { args = [], options = {} } = {}) =>
      this.fetch("run", {
        method: "POST",
        body: {
          name,
          args,
          options
        }
      });

    // ---------------------------------------------------------
    // Methods
    // ---------------------------------------------------------

    // Get username
    username = () => this.run("username");

    // Get environment variable
    getenv = (key, defaultValue = null) =>
      this.run("getenv", {
        args: [key, defaultValue]
      });

    // Set environment variable
    setenv = (key, value) =>
      this.run("setenv", {
        args: [key, value]
      });

    // Unset environment variable
    unsetenv = key =>
      this.run("unsetenv", {
        args: [key]
      });

    // Get complete environment
    environment = () => this.run("environment");

    // Get OS information
    info = () => this.run("info");
  }

  class Micro {
    constructor(name, manager) {
      this.name = name;
      this.manager = manager;
      this.destroyed = false;
    }

    // -------------------------
    // Start
    // -------------------------

    start() {
      if (this.destroyed) {
        throw new Error(`Micro "${this.name}" has already been destroyed`);
      }

      return this.manager.start(this.name);
    }

    // -------------------------
    // Output
    // -------------------------

    output() {
      if (this.destroyed) {
        throw new Error(`Micro "${this.name}" has already been destroyed`);
      }

      return this.manager.output(this.name);
    }

    // -------------------------
    // Send input
    // -------------------------

    send(data) {
      if (this.destroyed) {
        throw new Error(`Micro "${this.name}" has already been destroyed`);
      }

      return this.manager.send(this.name, data);
    }

    // -------------------------
    // Stop
    // -------------------------

    async stop() {
      if (this.destroyed) return;

      try {
        return await this.manager.stop(this.name);
      } finally {
        this.destroyed = true;
      }
    }

    // -------------------------
    // Cleanup
    // -------------------------

    async cleanup() {
      if (this.destroyed) return;

      try {
        await this.stop();
      } finally {
        this.destroyed = true;
        this.manager = null;
      }
    }

    // Alias
    destroy() {
      return this.cleanup();
    }
  }

  class MicroService extends Service {
    constructor(app) {
      super(app, "micro");

      // name -> Micro instance
      this.instances = new Map();
    }

    // -------------------------
    // App active services
    // -------------------------

    list = () => this.api("list");

    // -------------------------
    // Start
    // -------------------------

    start = async name => {
      const existing = this.instances.get(name);

      if (existing && !existing.destroyed) {
        return existing;
      }

      const { error } = await this.api("start", {
        method: "GET",
        params: {
          name
        }
      });

      if (error) {
        throw error;
      }

      const micro = new Micro(name, this);

      this.instances.set(name, micro);

      return micro;
    };

    // -------------------------
    // Output
    // -------------------------

    output = name =>
      this.api("output", {
        params: {
          name
        }
      });

    // -------------------------
    // Send input
    // -------------------------

    send = (name, data) =>
      this.api("send", {
        method: "POST",
        body: {
          name,
          data
        }
      });

    // -------------------------
    // Stop one service
    // -------------------------

    stop = async name => {
      try {
        return await this.api("stop", {
          params: {
            name
          }
        });
      } finally {
        this.instances.delete(name);
      }
    };

    // -------------------------
    // Stop everything
    // -------------------------

    stopAll = async () => {
      try {
        return await this.api("stop-all");
      } finally {
        this.instances.clear();
      }
    };

    // -------------------------
    // Cleanup
    // -------------------------

    cleanup = async () => {
      const instances = [...this.instances.values()];

      try {
        await Promise.allSettled(instances.map(instance => instance.cleanup()));

        await this.stopAll();
      } finally {
        this.instances.clear();
      }
    };

    // Alias
    destroy = this.cleanup;
  }

  class TaskHandler {
    constructor() {
      this.handlerID = generateUUID();

      this.running = false;
      this.destroyed = false;

      this._ondata_callbacks = new Set();

      this.events = {
        started: payload => {
          this.running = true;
          this.onstart?.(payload.output);
        },

        info: payload => {
          this.oninfo?.(payload.output);
        },

        output: payload => {
          this.onmessage?.(payload.output);
        },

        error: payload => {
          this.running = false;
          this.onerror?.(payload.output);
        },

        ended: payload => {
          this.running = false;
          this.onended?.(payload.output);
        }
      };

      // Internal event dispatcher
      this._eventHandler = payload => {
        this.events[payload?.status]?.(payload);
      };

      this._ondata_callbacks.add(this._eventHandler);
    }

    onData(callback) {
      if (this.destroyed) {
        throw new Error("Handler has been destroyed");
      }

      if (typeof callback !== "function") {
        throw new TypeError("Handler callback must be a function");
      }

      this._ondata_callbacks.add(callback);

      return () => {
        this.offData(callback);
      };
    }

    offData(callback) {
      this._ondata_callbacks.delete(callback);
    }

    emit(payload) {
      if (this.destroyed) {
        return;
      }

      for (const callback of this._ondata_callbacks) {
        try {
          callback(payload);
        } catch {
          // A listener must not break other listeners.
        }
      }
    }

    clearListeners() {
      for (const callback of this._ondata_callbacks) {
        if (callback !== this._eventHandler) {
          this._ondata_callbacks.delete(callback);
        }
      }
    }

    destroy() {
      if (this.destroyed) {
        return;
      }

      this.destroyed = true;

      this._ondata_callbacks.clear();

      this.events = null;

      this.onstart = null;
      this.oninfo = null;
      this.onmessage = null;
      this.onerror = null;
      this.onended = null;

      this.running = false;
    }
  }

  class Task {
    constructor(cmd, once, request) {
      this.cmd = cmd;
      this.request = request;
      this.handler = new TaskHandler();

      this.taskID = null;

      this.once = once;
      this.running = false;
      this.completed = false;
      this.destroyed = false;

      this.listeners = new Set();

      // Internal lifecycle listener
      this._internalListener = ({ status }) => {
        if (status === "started") {
          this.running = true;
        }

        if (status === "ended") {
          this.running = false;
          this.completed = true;
        }

        if (status === "error") {
          this.running = false;
        }
      };

      this._addHandlerListener(this._internalListener);
    }

    get handlerID() {
      return this.handler.handlerID;
    }

    // ----------------------------------------
    // Lifecycle
    // ----------------------------------------

    async init({ canSudo = false, outputMode = "send" } = {}) {
      this._assertNotDestroyed();

      if (this.isInitialized()) {
        throw new Error("Task already initialized");
      }

      const { data, error } = await this.request("create", {
        method: "POST",
        body: {
          cmd: this.cmd,
          can_sudo: canSudo,
          output_mode: outputMode
        }
      });

      if (error) {
        throw new Error(error.detail);
      }

      this.taskID = data.id;

      return data;
    }

    async run() {
      this._assertReady();

      if (this.running) {
        throw new Error("Task already running");
      }

      if (this.once && this.completed) {
        throw new Error("Task (once) already completed");
      }

      const { data, error } = await this.request("run", {
        params: {
          task_id: this.taskID,
          handler_id: this.handlerID
        }
      });

      if (error) {
        throw new Error(error.detail);
      }

      return data;
    }

    async kill(remove = false) {
      this._assertReady();

      if (!this.running) return;

      const { data, error } = await this.request("kill", {
        params: {
          task_id: this.taskID,
          remove
        }
      });

      if (error) {
        throw new Error(error);
      }

      this.running = false;

      return data;
    }

    async cleanup() {
      if (this.destroyed) {
        return;
      }
      await this.kill();

      this.destroyed = true;

      this._removeAllListeners();

      this.taskID = null;
      this.running = false;
      this.handler = null;
      this.func = null;
      this.listeners.clear();
    }

    destroy() {
      return this.cleanup();
    }

    // ----------------------------------------
    // Input
    // ----------------------------------------

    send(inputText, force = false) {
      this._assertReady();

      if (!inputText && !force) {
        return;
      }

      return this.request("send", {
        method: "POST",
        body: {
          task_id: this.taskID,
          input_text: inputText
        }
      });
    }

    // ----------------------------------------
    // Information
    // ----------------------------------------

    getInfo() {
      this._assertReady();

      return this.request("info", {
        params: {
          task_id: this.taskID
        }
      });
    }

    getSavedOutput() {
      this._assertReady();

      return this.request("output", {
        params: {
          task_id: this.taskID
        }
      });
    }

    clearSavedOutput() {
      this._assertReady();

      return this.request("clear", {
        params: {
          task_id: this.taskID
        }
      });
    }

    // ----------------------------------------
    // Events
    // ----------------------------------------

    on(callback) {
      this._assertNotDestroyed();

      if (typeof callback !== "function") {
        throw new TypeError("Task callback must be a function");
      }

      return this._addHandlerListener(callback);
    }

    off(callback) {
      if (!callback) {
        return;
      }

      this._removeHandlerListener(callback);
    }

    // ----------------------------------------
    // State
    // ----------------------------------------

    isInitialized() {
      return this.taskID !== null;
    }

    isRunning() {
      return this.running;
    }

    isCompleted() {
      return this.completed;
    }

    isDestroyed() {
      return this.destroyed;
    }

    // ----------------------------------------
    // Listener management
    // ----------------------------------------

    _addHandlerListener(callback) {
      if (!this.handler) {
        return () => {};
      }

      this.listeners.add(callback);

      const cleanup = this.handler.onData(callback);

      // If handler provides its own unsubscribe function,
      // return it while still tracking the callback.
      return () => {
        this._removeHandlerListener(callback);

        if (typeof cleanup === "function") {
          cleanup();
        }
      };
    }

    _removeHandlerListener(callback) {
      this.listeners.delete(callback);

      if (typeof this.handler?.offData === "function") {
        this.handler.offData(callback);
      }
    }

    _removeAllListeners() {
      if (typeof this.handler?.offData === "function") {
        for (const callback of this.listeners) {
          try {
            this.handler.offData(callback);
          } catch {
            // Ignore listener cleanup errors
          }
        }
      }

      this.listeners.clear();
    }

    // ----------------------------------------
    // Validation
    // ----------------------------------------

    _assertNotDestroyed() {
      if (this.destroyed) {
        throw new Error("Task has been destroyed");
      }
    }

    _assertReady() {
      this._assertNotDestroyed();

      if (!this.isInitialized()) {
        throw new Error("Task not initialized. Call 'init' first");
      }
    }
  }

  class Tasker extends Service {
    constructor(app) {
      super(app, "tasker");

      // All currently running tasks
      this.tasks = new Map();

      // On task data
      this.app.on("tasker-data", payload => {
        const { id, data } = payload;

        this.tasks.get(id)?.handler.emit(data);
      });

      // Init tasker
      this.app.on("start", async () => {
        await this.init();
      });
    }

    // Init tasker for app
    init = () => this.fetch("init");

    // Get tasks size
    get size() {
      return this.tasks.size;
    }

    // Create Task
    createTask(cmd, once = true) {
      const task = new Task(cmd, once, this.request);

      this.tasks.set(task.handlerID, task);

      return task;
    }

    // Remove Task
    async removeTask(task) {
      if (!task) {
        return;
      }

      this.tasks.delete(task.handlerID);

      return await task.cleanup();
    }

    // Remove all tasks
    async removeAll() {
      const tasks = [...this.tasks.values()];
      this.tasks.clear();

      await Promise.allSettled(tasks.map(task => task.cleanup()));
    }

    // Run task and clean on ended
    async doTask(cmd, callback, canSudo = true) {
      const task = this.createTask(cmd);

      try {
        await task.init({ canSudo });

        task.on(({ status, output }) => {
          try {
            callback?.({
              status,
              output
            });
          } catch {
            // User callback errors should
            // never break task lifecycle.
          }

          if (status === "ended" || status === "error") {
            void this.removeTask(task);
          }
        });

        await task.run();

        return task;
      } catch (error) {
        await this.removeTask(task);
        throw error;
      }
    }

    // Run task and get output
    // If callback passed runs with both, save and output live callbacks
    // Else only returns saved output in Array after complete
    async runSaveTask(cmd, callback = null, delayCheck = 5000) {
      const task = this.createTask(cmd);

      return new Promise(resolve => {
        let timer = null;
        let finished = false;

        const cleanup = async () => {
          if (timer) {
            clearTimeout(timer);
            timer = null;
          }

          await this.removeTask(task);
        };

        const fail = async error => {
          if (finished) {
            return;
          }

          finished = true;

          await cleanup();

          resolve({
            data: null,
            error: error instanceof Error ? error : new Error(String(error))
          });
        };

        const complete = async () => {
          if (finished) {
            return;
          }

          finished = true;

          try {
            const result = await task.getSavedOutput();

            if (result.error) {
              await cleanup();

              return resolve({
                data: null,
                error: new Error(result.error.detail)
              });
            }

            await cleanup();

            resolve({
              data: result.data || [],
              error: null
            });
          } catch (error) {
            await cleanup();

            resolve({
              data: null,
              error
            });
          }
        };

        const check = async () => {
          if (finished) {
            return;
          }

          try {
            const { data, error } = await task.getInfo();

            if (finished) {
              return;
            }

            if (error) {
              return fail(new Error(error.detail));
            }

            if (data.completed) {
              if (data.error_text) {
                return fail(new Error(data.error_text));
              }

              return complete();
            }

            timer = setTimeout(check, delayCheck);
          } catch (error) {
            await fail(error);
          }
        };

        const start = async () => {
          try {
            await task.init({
              outputMode: callback ? "*" : "save"
            });

            task.on(async ({ status, output }) => {
              if (finished) {
                return;
              }

              if (callback) {
                try {
                  callback({
                    status,
                    output
                  });
                } catch {
                  // Ignore callback errors
                }
              }

              if (status === "error") {
                return fail(output);
              }

              if (status === "ended") {
                return complete();
              }

              if (timer) {
                clearTimeout(timer);
              }

              timer = setTimeout(check, delayCheck);
            });

            await task.run();

            timer = setTimeout(check, delayCheck);
          } catch (error) {
            await fail(error);
          }
        };

        void start();
      });
    }

    // Run long polling for output by delay and return if ennded
    async runTaskPolling(cmd, delayCheck = 5000) {
      const task = this.createTask(cmd);

      try {
        await task.init({
          outputMode: "save"
        });

        await task.run();

        while (true) {
          const { data, error } = await task.getInfo();

          if (error) {
            throw new Error(error.detail);
          }

          if (data.completed) {
            const result = await task.getSavedOutput();

            if (result.error) {
              throw new Error(result.error.detail);
            }

            return {
              returncode: data.returncode,
              stdout: result.data || [],
              stderr: data.error_text
            };
          }

          await new Promise(resolve => setTimeout(resolve, delayCheck));
        }
      } finally {
        await this.removeTask(task);
      }
    }

    // Quick run and get { stdout, stderr, returncode }
    quickRun(cmd, { canSudo = false, input = [], timeout = null } = {}) {
      return this.request("quick", {
        method: "POST",
        body: {
          cmd,
          timeout,
          can_sudo: canSudo,
          input_args: input
        }
      });
    }

    // Stop and cleanup all running tasks
    async cleanup() {
      await this.removeAll();
    }
  }

  class AppInstaller {
    constructor(app) {
      this.app = app;

      this.appData = null;
      this.isGithub = false;
    }

    // ----------------------------------------
    // Info
    // ----------------------------------------

    getTempID = () => this.appData?.temp_id;

    getPreviewUrl = file =>
      this.app.getUrl(
        `${this.app.system.baseURL}/kpm/preview/${this.getTempID()}/${encodeURIComponent(file)}`
      );

    // ----------------------------------------
    // Prepare local package
    // ----------------------------------------

    prepare = async file => {
      if (this.appData) {
        return this.appData;
      }

      const formData = new FormData();
      formData.append("file", file);

      const { data, error } = await this.app.system.request("kpm/prepare-local", {
        method: "POST",
        body: formData
      });

      if (error) {
        throw new Error(error.detail);
      }

      this.appData = data;
      this.isGithub = false;

      return data;
    };

    // from storage path
    storage = async path => {
      if (this.appData) {
        return this.appData;
      }

      const { data, error } = await this.app.system.request(
        "kpm/prepare-storage",
        {
          method: "POST",
          params: { path }
        }
      );

      if (error) {
        throw new Error(error.detail);
      }

      this.appData = data;
      this.isGithub = false;

      return data;
    };

    // ----------------------------------------
    // Prepare Github package
    // ----------------------------------------

    github = async (url, tag = null) => {
      if (this.appData) {
        return this.appData;
      }

      const { data, error } = await this.app.system.request(
        "kpm/prepare-github",
        {
          method: "POST",
          params: {
            url,
            tag
          }
        }
      );

      if (error) {
        throw new Error(error.detail);
      }

      this.appData = data;
      this.isGithub = true;

      return data;
    };

    // ----------------------------------------
    // Install
    // ----------------------------------------

    install = async () => {
      if (!this.appData) {
        throw new Error("No prepared installation session");
      }

      const { data, error } = await this.app.system.request(
        "kpm/confirm-install",
        {
          method: "POST",
          params: {
            temp_id: this.getTempID()
          }
        }
      );

      if (error) {
        throw new Error(error.detail);
      }

      return data;
    };
  }

  class Kpm {
    constructor(app) {
      this.app = app;

      // Named/reusable installers
      this._installers = new Map();
    }

    // ----------------------------------------
    // Create
    // ----------------------------------------

    createInstaller = () => {
      return new AppInstaller(this.app);
    };

    // ----------------------------------------
    // Get installer
    // ----------------------------------------

    getInstaller = name => {
      if (!name) {
        return this.createInstaller();
      }

      if (!this._installers.has(name)) {
        this._installers.set(name, this.createInstaller());
      }

      return this._installers.get(name);
    };

    // ----------------------------------------
    // Remove installer
    // ----------------------------------------

    removeInstaller = name => {
      if (!name) {
        return;
      }

      this._installers.delete(name);
    };

    // ----------------------------------------
    // Clear installers
    // ----------------------------------------

    clearInstallers = () => {
      this._installers.clear();
    };

    // ----------------------------------------
    // Installer count
    // ----------------------------------------

    get installerCount() {
      return this._installers.size;
    }

    // ----------------------------------------
    // Installed apps
    // ----------------------------------------

    getInstalledApps = () => this.app.system.request("kpm/installed-apps");

    // ----------------------------------------
    // App info
    // ----------------------------------------

    getAppInfo = name =>
      this.app.system.request("kpm/app-info", {
        params: { name }
      });

    // ----------------------------------------
    // Uninstall app
    // ----------------------------------------

    uninstallApp = async (name, keepData = false) => {
      const { data, error } = await this.app.system.request("kpm/uninstall", {
        params: {
          app_name: name,
          keep_data: keepData
        }
      });

      if (error) {
        throw new Error(error.detail);
      }

      return data;
    };
  }

  class Alert {
    constructor(_alert) {
      this._alert = _alert;
      this.uid = generateUUID();

      this.onclick = null;

      this._sticky = false;
      this._silent = false;
      this._priority = "normal";
      this._label = null;
      this._extra = {};
    }

    // ----------------------------------------
    // Configuration
    // ----------------------------------------

    setSticky(value = true) {
      this._sticky = Boolean(value);
      return this;
    }

    setSilent(value = true) {
      this._silent = Boolean(value);
      return this;
    }

    setPriority(priority = "normal") {
      if (!["less", "normal", "high"].includes(priority)) {
        throw new Error(`Invalid priority option: ${priority}`);
      }

      this._priority = priority;

      return this;
    }

    setLabel(label = null) {
      this._label = label;
      return this;
    }

    setExtra(key, value) {
      this._extra[key] = value;
      return this;
    }

    setIsCode(value = true) {
      return this.setExtra("isCode", Boolean(value));
    }

    // ----------------------------------------
    // Actions
    // ----------------------------------------

    onClick(callback) {
      this.onclick = callback;
      return this;
    }

    show(message, type = "info") {
      return this._alert({
        uid: this.uid,
        type,
        message,
        label: this._label,
        extra: {
          ...this._extra
        },
        silent: this._silent,
        sticky: this._sticky,
        priority: this._priority
      });
    }

    hide() {
      return this.show("");
    }
  }

  class Alerts {
    constructor(app) {
      this.app = app;

      // All currently owned alerts
      this.alerts = new Map();

      this.app.onMessage("alert:click", this._onAlertClick);

      this.destroyed = false;
    }

    // ----------------------------------------
    // Events
    // ----------------------------------------

    _onAlertClick = ({ uid }) => {
      const alert = this.alerts.get(uid);

      if (alert) {
        alert.onclick?.();
      }
    };

    // ----------------------------------------
    // Create
    // ----------------------------------------

    createAlert() {
      if (this.destroyed) {
        throw new Error("Alerts has been destroyed");
      }

      const alert = new Alert(this.app.system._alert);

      this.alerts.set(alert.uid, alert);

      return alert;
    }

    // ----------------------------------------
    // Quick Alert
    // ----------------------------------------

    alert(message, { type = "info", priority = "normal" } = {}) {
      return this.system.alert(message, { type, priority });
    }

    // ----------------------------------------
    // Remove one
    // ----------------------------------------

    clearAlert(alert) {
      if (!alert) {
        return;
      }

      this.alerts.delete(alert.uid);

      try {
        alert.hide();
      } catch {
        // Ignore alert cleanup errors
      }
    }

    // ----------------------------------------
    // Remove everything
    // ----------------------------------------

    clearAll() {
      const alerts = this.alerts.values();

      this.alerts.clear();

      for (const alert of alerts) {
        try {
          alert.hide();
        } catch {
          // Ignore alert cleanup errors
        }
      }
    }

    // ----------------------------------------
    // Alert count
    // ----------------------------------------

    get size() {
      return this.alerts.size;
    }

    // ----------------------------------------
    // Destroy
    // ----------------------------------------

    cleanup() {
      if (this.destroyed) {
        return;
      }

      this.app.offMessage("alert:click", this._onAlertClick);

      this.destroyed = true;

      this.clearAll();
    }

    destroy() {
      return this.cleanup();
    }
  }

  class Invoker {
    constructor(app) {
      this.app = app;
    }

    // Invoke
    _invoke = (action, payload = {}) =>
      this.app.system.request("invoke", {
        method: "POST",
        body: {
          action,
          payload
        }
      });

    // Open App
    openApp = (name, { args = [], query = {} } = {}) =>
      this._invoke("openApp", {
        name,
        args,
        query
      });

    // Action
    action = (name, options = {}) => this._invoke("action", { name, options });

    // Share Item
    share = item => this.action("share", { item });

    // Change ui wallpaper (accepts: url, /files...path)
    setWallpaper = url => this.action("set-wallpaper", { url });

    // Change app theme in ui
    setTheme = name => this.action("set-theme", { name });
  }

  exports.Alerts = Alerts;
  exports.FileSystemService = FileSystemService;
  exports.Invoker = Invoker;
  exports.KVService = KVService;
  exports.KikxConfig = KikxConfig;
  exports.Kpm = Kpm;
  exports.MicroService = MicroService;
  exports.OSService = OSService;
  exports.ProxyService = ProxyService;
  exports.Service = Service;
  exports.TaskerService = Tasker;
  exports.createApp = createKikxApp;
  exports.createClientApp = createKikxClient;
  exports.getKikxApp = getKikxApp;

}));
