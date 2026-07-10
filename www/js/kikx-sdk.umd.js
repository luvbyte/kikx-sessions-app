(function (global, factory) {
  typeof exports === 'object' && typeof module !== 'undefined' ? factory(exports) :
  typeof define === 'function' && define.amd ? define(['exports'], factory) :
  (global = typeof globalThis !== 'undefined' ? globalThis : global || self, factory(global.kikxSdk = {}));
})(this, (function (exports) { 'use strict';

  function generateUUID() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
      const r =
        (crypto.getRandomValues(new Uint8Array(1))[0] & 15) >>
        (c === "x" ? 0 : 4);
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  // Event handler
  class Handler {
    constructor() {
      this.handlerID = generateUUID();
      this.running = false;
      this._ondata_callbacks = new Set();

      this.events = {
        started: payload => {
          this.running = true;
          this.onstart?.(payload.output);
        },
        info: payload => this.oninfo?.(payload.output),
        output: payload => this.onmessage?.(payload.output),
        error: payload => {
          this.running = false;
          this.onerror?.(payload.output);
        },
        ended: payload => {
          this.running = false;
          this.onended?.(payload.output);
        }
      };

      this._ondata_callbacks.add(payload =>
        this.events[payload.status]?.(payload)
      );
    }

    onData(callback) {
      this._ondata_callbacks.add(callback);
    }
  }

  class AppTask {
    constructor(cmd, handler, func, once = true) {
      this.cmd = cmd;
      this.func = func;
      this.handler = handler;

      this.running = false;
      this.taskID = null;

      this.once = once;
      this.completed = false;

      this.handler?.onData(data => {
        if (data.status === "ended") {
          this.running = false;
          this.completed = true;
        }
      });
    }

    async init({
      noSudo = false,
      allowCommands = false,
      outputMode = "send"
    } = {}) {
      if (this.taskID) throw Error("Task already Created");

      const { data, error } = await this.func("tasks.create_task", {
        args: [`${this.cmd}`.trim()],
        options: {
          no_sudo: noSudo,
          allow_commands: allowCommands,
          output_mode: outputMode
        }
      });

      if (error) throw Error(error.detail);

      this.taskID = data.id;

      return data;
    }

    async __run() {
      if (!this.taskID) throw Error("Task not initialized call 'init' first");

      if (this.once && this.completed)
        throw Error("Task (Once) already completed");

      this.running = true;

      const { error, data } = await this.func("tasks.run_task", {
        args: [],
        options: {
          task_id: this.taskID,
          handler_id: this.handler ? this.handler.handlerID : null
        }
      });

      if (error) {
        this.running = false;
        throw Error(error.detail);
      }

      return data;
    }

    async run() {
      if (this.running) throw Error("Task already running");

      this.running = true;

      return await this.__run();
    }

    async send(input) {
      if (!this.taskID || !input) throw Error("No input or task error");

      await this.func("tasks.send_input", {
        args: [this.taskID, input]
      });
    }

    async command(event, payload = {}) {
      return await this.func("tasks.task_command", {
        args: [this.taskID, event],
        options: { payload }
      });
    }

    async getInfo(event, payload = {}) {
      return await this.func("tasks.get_task_info", {
        args: [this.taskID]
      });
    }

    async getSavedOutput() {
      return await this.func("tasks.get_task_output", {
        args: [this.taskID]
      });
    }

    on(callback) {
      this.handler?.onData(callback);
    }

    _kill(remove = false) {
      return this.func("tasks.kill", {
        args: [this.taskID],
        options: { remove }
      });
    }

    async kill() {
      return await this._kill();
    }
  }

  class AppTasks {
    constructor(app) {
      if (!app) {
        throw Error("AppTasks must require KikxApp, KikxAppClient");
      }

      this.app = app;
    }

    runFunc = (name, options) => {
      return this.app.func(name, options);
    };

    createTask(cmd, once = true) {
      if (!this.app.func) {
        throw Error("KikxAppClient is required as app to create task");
      }

      const handler = this.app.createHandler();

      return new AppTask(cmd, handler, this.runFunc, once);
    }

    // Kill & Clear task and handler
    async clearTask(task) {
      await task._kill(true);

      this.app.removeHandler(task.handler.handlerID);
    }

    //
    async doTask(cmd, callback) {
      const task = this.createTask(cmd);
      await task.init();

      task.on(data => {
        callback({ data, task });
      });

      return await task.__run();
    }

    // Checks every delayCheck(ms) = 5 seconds
    // if no output then gets taskInfo
    // checks if completed then returns data
    // Runs task with save mode and return data, error
    async runSaveTask(cmd, callback = null, delayCheck = 5000) {
      const task = this.createTask(cmd);

      return new Promise(resolve => {
        let timer;
        let finished = false;

        const cleanup = async () => {
          clearTimeout(timer);
          await this.clearTask(task);
        };

        const fail = async error => {
          if (finished) return;

          finished = true;
          await cleanup();

          resolve({
            data: null,
            error: error instanceof Error ? error : new Error(String(error))
          });
        };

        const complete = async () => {
          if (finished) return;

          finished = true;

          try {
            const { data, error } = await task.getSavedOutput();

            await cleanup();

            if (error) {
              return resolve({
                data: null,
                error: new Error(error.detail)
              });
            }

            resolve({
              data: data || [],
              error: null
            });
          } catch (err) {
            await cleanup();

            resolve({
              data: null,
              error: err
            });
          }
        };

        const resetWatchdog = () => {
          if (finished) return;

          clearTimeout(timer);

          timer = setTimeout(async () => {
            if (finished) return;

            try {
              const { data, error } = await task.getInfo();

              if (finished) return;

              if (error) {
                return await fail(new Error(error.detail));
              }

              if (data.completed) {
                if (data.error_text) {
                  return await fail(new Error(data.error_text));
                }

                return await complete();
              }

              resetWatchdog();
            } catch (err) {
              return await fail(err);
            }
          }, delayCheck);
        };

        (async () => {
          try {
            await task.init({
              outputMode: callback ? "*" : "save"
            });

            resetWatchdog();

            task.on(async ({ status, output }) => {
              if (finished) return;

              if (callback) {
                try {
                  callback({ status, output });
                } catch {
                  // Ignore callback errors
                }
              }

              if (status === "error") {
                return await fail(output);
              }

              if (status === "ended") {
                return await complete();
              }

              // Refresh watchdog only while task is active.
              resetWatchdog();
            });

            await task.__run();
          } catch (err) {
            await fail(err);
          }
        })();
      });
    }

    // Long polling task
    async runTaskPolling(cmd, delayCheck = 5000) {
      const task = new AppTask(cmd, null, this.runFunc, true);

      try {
        await task.init({
          outputMode: "save"
        });

        await task.__run();

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
        await task._kill(true);
      }
    }

    // Quick task with input
    quickRun(cmd, { noSudo = false, input = [], timeout = 0 } = {}) {
      return this.app.func("tasks.quick_run", {
        timeout,
        args: [cmd.trim()],
        options: {
          no_sudo: noSudo,
          input_args: input
        }
      });
    }
  }

  async function request(
    endpoint,
    method = "GET",
    body = null,
    isJson = true,
    headers = {}
  ) {
    headers = { ...headers };

    if (body && isJson) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(body);
    }

    try {
      const response = await fetch(endpoint, {
        method,
        headers,
        body
      });

      const contentType = response.headers.get("content-type");
      let data = null;

      if (response.status !== 204) {
        if (contentType?.includes("application/json")) {
          data = await response.json();
        } else if (contentType?.includes("text/")) {
          data = await response.text();
        } else if (contentType?.includes("application/octet-stream")) {
          data = await response.blob();
        }
      }

      return {
        ok: response.ok,
        code: response.status,
        contentType,
        data: response.ok ? data : null,
        error: response.ok ? null : data || `Error ${response.status}`
      };
    } catch (err) {
      return {
        ok: false,
        code: 500,
        data: null,
        error: err.message || "Unknown error"
      };
    }
  }

  class Service {
    constructor(app, name) {
      this.app = app;
      this.serviceName = name;
      this.baseURL = `/service/${this.serviceName}`;
    }

    async request(endpoint, method = "GET", body = null, isJson = true) {
      let headers = {};

      Object.assign(headers, { "kikx-app-id": this.app.getAppID() });

      return await request(
        this.app.getUrl(`${this.baseURL}/${endpoint}`),
        method,
        body,
        isJson,
        headers
      );
    }

    async fetch(endpoint, method = "GET", body = null, isJson = true) {
      const res = await this.request(endpoint, method, body, isJson);

      if (!res.ok) {
        throw new Error(res.error?.detail || "Unknown Error");
      }

      return res.data;
    }
  }

  class FileSystemService extends Service {
    constructor(app) {
      super(app, "fs");
    }
    // List files by limit & sorting
    listFilesLimit(
      directory,
      { offset = 0, limit = 50, sort = "name", asc = true } = {}
    ) {
      const params = new URLSearchParams({
        directory,
        offset: String(offset),
        limit: String(limit),
        sort,
        asc: String(asc)
      });

      const url = `list?${params.toString()}`;

      return this.request(url);
    }
    // Get thumbnail
    thumbnail = filename =>
      this.request(`thumbnail?filename=${encodeURIComponent(filename)}`);
    // List files in directory
    listFiles = directory =>
      this.request(`list?directory=${encodeURIComponent(directory)}`);
    // Read file
    readFile = filename =>
      this.request(`read?filename=${encodeURIComponent(filename)}`);
    // Write file
    writeFile = (filename, content) =>
      this.request("write", "POST", { filename, content });
    // Delete file
    deleteFile = filename =>
      this.request(`delete?filename=${encodeURIComponent(filename)}`, "DELETE");
    // Upload file
    uploadFile = (file, dest) => {
      const formData = new FormData();
      formData.append("files", file);

      return this.request(
        `upload?dest=${encodeURIComponent(dest)}`,
        "POST",
        formData,
        false
      );
    };
    // Upload files
    uploadFiles(files, dest) {
      const formData = new FormData();

      files.forEach(file => {
        formData.append("files", file);
      });

      return this.request(
        `upload?dest=${encodeURIComponent(dest)}`,
        "POST",
        formData,
        false
      );
    }
    // Create File
    createFile = filename =>
      this.request("create_file", "POST", {
        filename
      });
    // Create directory
    createDirectory = dirname =>
      this.request("create_directory", "POST", { dirname });
    // Delete directory
    deleteDirectory = dirname =>
      this.request(
        `delete_directory?dirname=${encodeURIComponent(dirname)}`,
        "DELETE"
      );
    // Delete list
    deleteList = paths => this.request("delete-list", "POST", { paths });
    // Rename
    rename = (source, new_name) =>
      this.request("rename", "POST", { source, new_name });
    // Info
    info = path => this.request(`info?path=${encodeURIComponent(path)}`);
    // Copy
    copy = (source, dest) => this.request("copy", "POST", { source, dest });
    // Move
    move = (source, dest) => this.request("move", "POST", { source, dest });
  }

  class ProxyService extends Service {
    constructor(app) {
      super(app, "proxy");
    }
    fetch(url, { method = "GET", headers = {}, body = null } = {}) {
      return globalThis.fetch(`${this.baseURL}?url=${encodeURIComponent(url)}`, {
        method,
        headers,
        ...(body != null && { body })
      });
    }
  }

  class KVService extends Service {
    constructor(app) {
      super(app, "kv");
    }
    // Get info
    info = () => this.fetch("info");
    // Get value by key
    get = key => this.fetch(`get?key=${key}`);
    // Set key: value
    set = (key, value) => this.fetch("set", "POST", { key, value });
    // Check if key exists
    exists = key => this.fetch(`exists?key=${key}`);
    // Get or set
    getOrSet = (key, value) => this.fetch("get-set", "POST", { key, value });
    // Pop
    pop = key => this.fetch(`pop?key=${key}`);
    // Save
    save = () => this.fetch("save", "POST");
    // Reset
    reset = () => this.fetch("reset", "POST");
    // Config
    config = command => this.fetch(`config?command=${command}`);
  }

  class OSService extends Service {
    constructor(app) {
      super(app, "os");
    }
    // Run function in os service
    func = (name, { args = [], options = {} }) =>
      this.request("run", "POST", { name, args, options });
  }

  class KikxConfig {
    constructor(config = {}) {
      const { apiUrl, wsUrl, appID } = config || {};

      this.customApiUrl = apiUrl;
      this.customWsUrl = wsUrl;
      this.customAppID = appID || window.location.pathname.split("/")[2] || null;
    }
    
    getAppID = () => this.customAppID
    

    configureUrls(options = {}) {
      const { apiUrl, wsUrl, appID } = options;

      if (apiUrl) this.customApiUrl = apiUrl;
      if (wsUrl) this.customWsUrl = wsUrl;
      if (appID) this.customAppID = appID;
    }

    getDefaultBase() {
      const { protocol, hostname, port } = window.location;
      return `${protocol}//${hostname}${port ? `:${port}` : ""}`;
    }

    apiUrl() {
      return this.customApiUrl || this.getDefaultBase();
    }

    getWsUrl() {
      if (this.customWsUrl) return this.customWsUrl;

      const { protocol, hostname, port } = window.location;
      return `${protocol === "https:" ? "wss:" : "ws:"}//${hostname}${port ? `:${port}` : ""}`;
    }

    getUrl(end) {
      const endUrl = end.startsWith("/") ? end : `/${end}`;
      return this.apiUrl() + endUrl;
    }
  }

  class SystemService extends Service {
    constructor(app) {
      super(app, "system");
    }
    // /info
    appInfo = () => this.fetch("info/app");
    // Get app names in list
    getAppsList = (extra = false) => this.fetch(`info/apps-list?extra=${extra}`);
    // Sessions
    sessionsInfo = () => this.request("info/sessions");
    // Close Sessions
    closeSession = sessionID =>
      this.request(`info/session/close/${sessionID}`, "POST");
    // notify
    alert = payload => this.fetch("alert", "POST", payload);
    // App function x
    appFunc = (name, config) =>
      this.request("app/func", "POST", { name, config });
    // Close app by itself
    closeApp = () => this.fetch("close-app", "POST");
    // Invoke an action
    invoke = (action, payload = {}) =>
      this.request("invoke", "POST", { action, payload });
  }

  // Singleton state
  let instance = null;
  let instanceType = null;

  // Base App
  class KikxApp {
    constructor(config = {}) {
      this.config = new KikxConfig(config);
      this.system = new SystemService(this);
    }

    async run(callback = null) {
      this.appInfo = await this.fetchAppInfo();

      if (typeof callback === "function") {
        await callback(this.appInfo);
      }
    }

    // Get appID
    getAppID = () => {
      return this.config.getAppID();
    };

    // Get app api url
    getUrl = end => {
      return this.config.getUrl(end);
    };

    // Get app ws url
    getWsUrl = () => {
      return this.config.getWsUrl();
    };

    // Get app info
    fetchAppInfo() {
      return this.system.appInfo();
    }

    // Run app funcx
    func(name, options) {
      return this.system.appFunc(name, options);
    }
  }

  // Client App
  class KikxAppClient extends KikxApp {
    constructor(config = {}) {
      super(config);

      // App Config
      this.appConfig = {};

      this.ws = null;
      this.eventCallbacks = {};

      this.appEventHandlers = new Map();

      this.reconnectAttempts = 0;
      this.reconnectDelay = 1000;
      this._reconnectTimer = null;
      this.maxReconnectAttempts = 13;

      this.on("reconnected", () => {
        this.reconnectAttempts = 0;
      });

      // Event: App-specific handler
      this.on("handler-data", payload => {
        this.appEventHandlers
          .get(payload.id)
          ?._ondata_callbacks.forEach(fn => fn(payload.data));
      });

      // Send event to kikx -> app
      if (typeof document !== "undefined") {
        document.addEventListener("visibilitychange", () => {
          if (!this.ws) return;

          try {
            if (document.visibilityState === "visible") {
              this.send({
                event: "app:focus",
                payload: { app_id: this.getAppID() }
              });
            } else if (document.visibilityState === "hidden") {
              this.send({
                event: "app:blur",
                payload: { app_id: this.getAppID() }
              });
            }
          } catch (_) {}
        });
      }

      // if (typeof document !== "undefined") {
      //   document.addEventListener("visibilitychange", () => {
      //     if (this.ws && document.visibilityState === "visible") {
      //       try {
      //         this.send({
      //           event: "app:focus",
      //           payload: { app_id: this.getAppID() }
      //         });
      //       } catch (_) {}
      //     }
      //   });
      // }
    }

    // Create app handler
    createHandler() {
      const handler = new Handler();
      this.appEventHandlers.set(handler.handlerID, handler);
      return handler;
    }

    // Remove app handler
    removeHandler(handlerID) {
      this.appEventHandlers.delete(handlerID);
    }

    // Reconnect
    _forceReconnect(reason = "manual trigger") {
      this._clearReconnectTimer();
      this.reconnectAttempts = 0;
      this._connect();
    }

    // Connect app ws
    _connect() {
      if (this.ws) return;

      const url = `${this.getWsUrl()}/app/${this.getAppID()}`;
      this.ws = new WebSocket(url);

      this.ws.onopen = e => {
        this._clearReconnectTimer();
        this._callEvent("ws:onopen", e);
      };

      this.ws.onmessage = e => {
        try {
          this._callEvent("ws:onmessage", e);

          const message = JSON.parse(e.data);
          const { event, payload } = message;

          if (["connected", "reconnected"].includes(event)) {
            this.appConfig = payload.config;
          }

          if (event) {
            this._callEvent(event, payload);
          }
        } catch (err) {
          console.error("WebSocket message parse error:", err);
        }
      };

      this.ws.onclose = e => {
        this.ws = null;
        this._callEvent("ws:onclose", e);
        this._scheduleReconnect();
      };

      this.ws.onerror = e => {
        this._callEvent("ws:onerror", e);
        if (this.ws) {
          this.ws.close();
          this.ws = null;
        }
      };
    }

    _scheduleReconnect() {
      if (this._reconnectTimer) return;

      console.log("Schedule Reconecting...");

      if (this.reconnectAttempts >= this.maxReconnectAttempts) {
        console.log("Schedule Reconecting failed");
        this._callEvent("ws:reconnect_failed");
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

    // Add app ws event handler
    on(event, callback) {
      if (!this.eventCallbacks[event]) {
        this.eventCallbacks[event] = [];
      }
      this.eventCallbacks[event].push(callback);
    }

    // Remove app ws event handler
    off(event, callback) {
      if (!this.eventCallbacks[event]) return;

      this.eventCallbacks[event] = this.eventCallbacks[event].filter(
        fn => fn !== callback
      );
    }

    // Call ws event handler
    _callEvent(event, data = null) {
      if (this.eventCallbacks[event]) {
        this.eventCallbacks[event].forEach(fn => fn(data));
      }
    }

    // Send Json data to app using ws
    send(data) {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify(data));
      }
    }

    // Run and connect ws
    async run(callback = null) {
      if (this.ws && this.ws.readyState < WebSocket.CLOSING) return;

      if (typeof callback === "function") {
        this.on("connected", callback);
      }

      this._connect();
    }
  }

  // Create Base App
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

  // Create Client App
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

  // Get Existing Instance
  function getKikxApp() {
    if (!instance) {
      throw new Error(
        "KikxApp not created. Call createKikxApp() or createKikxClient() first."
      );
    }
    return instance;
  }

  exports.AppTasks = AppTasks;
  exports.FileSystemService = FileSystemService;
  exports.KVService = KVService;
  exports.KikxConfig = KikxConfig;
  exports.OSService = OSService;
  exports.ProxyService = ProxyService;
  exports.Service = Service;
  exports.createApp = createKikxApp;
  exports.createClientApp = createKikxClient;
  exports.getKikxApp = getKikxApp;

}));
