/**
 * Nim Bindweb Browser Runtime -- ES Module
 * Generated from schema.def -- DO NOT EDIT
 */

export function createBindwebRunner(outputContainer) {
    const decoder = new TextDecoder();
    const text_encoder = new TextEncoder();

    let memory = null, exports = null, table = null, connected = false;
    let u8, i32, f32, f64;
    let event_buffer_ptr_val, event_offset_ptr_val, scratch_buffer_ptr_val;
    let event_u8, event_i32, event_offset_view, EVENT_BUFFER_SIZE;
    let _updateFn = null, _updatePending = false, _eventAttached = false;

    const elements = []; elements[0] = outputContainer || document.body;
    const freeHandles = [];
    let nextHandle = 1;
    function allocHandle(el) {
        const h = freeHandles.length ? freeHandles.pop() : nextHandle++;
        elements[h] = el;
        return h;
    }
    function releaseHandle(h) {
        if (h <= 0) return;
        elements[h] = undefined;
        freeHandles.push(h);
    }
    const contexts = [];
    const audios = [], websockets = [], images = [];
    const webgl_shaders = [], webgl_programs = [], webgl_buffers = [], webgl_uniforms = [];
    const webgpu_adapters = [], webgpu_devices = [], webgpu_queues = [];
    const webgpu_shaders = [], webgpu_encoders = [], webgpu_views = [];
    const webgpu_passes = [], webgpu_buffers = [], webgpu_pipelines = [];

    function refreshViews() {
        if (!memory) return;
        u8 = new Uint8Array(memory.buffer); i32 = new Int32Array(memory.buffer);
        f32 = new Float32Array(memory.buffer); f64 = new Float64Array(memory.buffer);
        event_u8 = new Uint8Array(memory.buffer, event_buffer_ptr_val);
        event_i32 = new Int32Array(memory.buffer, event_buffer_ptr_val);
        event_offset_view = new Uint32Array(memory.buffer, event_offset_ptr_val, 1);
    }
    function _triggerUpdate() {
        if (_updateFn && !_updatePending) { _updatePending = true; queueMicrotask(() => { _updatePending = false; _updateFn(performance.now()); }); }
    }
    // Alias used by INIT_KEYBOARD / INIT_MOUSE / INIT_MOUSE_WHEEL handlers
    // (the generated command snippets call _triggerDiscreteUpdate). It behaves
    // the same as _triggerUpdate: schedule one update pass after a discrete
    // input event. Previously undeclared, which threw a ReferenceError the
    // first time a keydown/mousedown fired after init.
    function _triggerDiscreteUpdate() { _triggerUpdate(); }

    // -- Import functions (env.*) called from WASM --
    const envImports = {
        bindweb_js_flush: (ptr, size) => { flush(ptr, size); },
        __cxa_atexit: () => 0, __cxa_thread_atexit: () => 0, __cxa_finalize: () => {},

        bindweb_dom_get_body: () => {
            if(!elements[0]) elements[0] = outputContainer || document.body; return 0;
        }
,
        bindweb_dom_get_element_by_id: (id_ptr, id_len) => {
            const id = decoder.decode(new Uint8Array(memory.buffer, id_ptr, id_len));
            const el = document.getElementById(id); if(!el) { console.warn('get_element_by_id: element not found', id); return -1; } return allocHandle(el);
        }
,
        bindweb_dom_create_element: (tag_ptr, tag_len) => {
            const tag = decoder.decode(new Uint8Array(memory.buffer, tag_ptr, tag_len));
            return allocHandle(document.createElement(tag));
        }
,
        bindweb_dom_create_element_scoped: (tag_ptr, tag_len, scope_ptr, scope_len) => {
            const tag = decoder.decode(new Uint8Array(memory.buffer, tag_ptr, tag_len));
            const scope = decoder.decode(new Uint8Array(memory.buffer, scope_ptr, scope_len));
            const el = document.createElement(tag); el.setAttribute('coi-scope', scope); return allocHandle(el);
        }
,
        bindweb_dom_create_comment: (text_ptr, text_len) => {
            const text = decoder.decode(new Uint8Array(memory.buffer, text_ptr, text_len));
            return allocHandle(document.createComment(text));
        }
,
        bindweb_dom_create_text_node: (text_ptr, text_len) => {
            const text = decoder.decode(new Uint8Array(memory.buffer, text_ptr, text_len));
            return allocHandle(document.createTextNode(text));
        }
,
        bindweb_dom_get_attribute: (handle, name_ptr, name_len) => {
            const name = decoder.decode(new Uint8Array(memory.buffer, name_ptr, name_len));
            const el = elements[handle]; if(!el){ console.warn('get_attribute: unknown element handle', handle); return 0; } const ret = el.getAttribute(name) || "";
            const encoded = text_encoder.encode(ret);
            const len = encoded.length;
            new Uint8Array(memory.buffer, scratch_buffer_ptr_val).set(encoded);
            return len;
        }
,
        bindweb_canvas_create_canvas: (dom_id_ptr, dom_id_len, width, height) => {
            const dom_id = decoder.decode(new Uint8Array(memory.buffer, dom_id_ptr, dom_id_len));
            const c = document.createElement('canvas'); c.id = dom_id; c.width = width; c.height = height; elements[dom_id] = c; return allocHandle(c);
        }
,
        bindweb_canvas_get_context_2d: (canvas_handle) => {
            const c = elements[canvas_handle]; if(!c) { console.warn('get_context_2d: unknown canvas', canvas_handle); return -1; } const ctx = c.getContext('2d'); const handle = freeHandles.length ? freeHandles.pop() : nextHandle++; contexts[handle] = ctx; return handle;
        }
,
        bindweb_canvas_get_context_webgl: (canvas_handle) => {
            const c = elements[canvas_handle]; if(!c) { console.warn('get_context_webgl: unknown canvas', canvas_handle); return -1; } const ctx = c.getContext('webgl') || c.getContext('experimental-webgl'); const handle = freeHandles.length ? freeHandles.pop() : nextHandle++; contexts[handle] = ctx; return handle;
        }
,
        bindweb_canvas_get_context_webgpu: (canvas_handle) => {
            const c = elements[canvas_handle]; if(!c) { console.warn('get_context_webgpu: unknown canvas', canvas_handle); return -1; } const ctx = c.getContext('webgpu'); const handle = freeHandles.length ? freeHandles.pop() : nextHandle++; contexts[handle] = ctx; return handle;
        }
,
        bindweb_canvas_measure_text_width: (handle, text_ptr, text_len) => {
            const text = decoder.decode(new Uint8Array(memory.buffer, text_ptr, text_len));
            const ctx = contexts[handle]; return (ctx ? ctx.measureText(text).width : 0);
        }
,
        bindweb_system_get_time: () => {
            return performance.now();
        }
,
        bindweb_system_get_date_now: () => {
            return Date.now();
        }
,
        bindweb_system_get_pathname: () => {
            const ret = window.location.pathname || "/";
            const encoded = text_encoder.encode(ret);
            const len = encoded.length;
            new Uint8Array(memory.buffer, scratch_buffer_ptr_val).set(encoded);
            return len;
        }
,
        bindweb_system_get_search: () => {
            const ret = window.location.search || "";
            const encoded = text_encoder.encode(ret);
            const len = encoded.length;
            new Uint8Array(memory.buffer, scratch_buffer_ptr_val).set(encoded);
            return len;
        }
,
        bindweb_system_get_query_param: (name_ptr, name_len) => {
            const name = decoder.decode(new Uint8Array(memory.buffer, name_ptr, name_len));
            const ret = new URLSearchParams(window.location.search).get(name) || "";
            const encoded = text_encoder.encode(ret);
            const len = encoded.length;
            new Uint8Array(memory.buffer, scratch_buffer_ptr_val).set(encoded);
            return len;
        }
,
        bindweb_system_get_visibility_state: () => {
            const ret = document.visibilityState || 'visible';
            const encoded = text_encoder.encode(ret);
            const len = encoded.length;
            new Uint8Array(memory.buffer, scratch_buffer_ptr_val).set(encoded);
            return len;
        }
,
        bindweb_system_is_hidden: () => {
            return document.hidden ? 1 : 0;
        }
,
        bindweb_audio_create_audio: (src_ptr, src_len) => {
            const src = decoder.decode(new Uint8Array(memory.buffer, src_ptr, src_len));
            const a = new Audio(src); const handle = allocHandle(a); audios[handle] = a; return handle;
        }
,
        bindweb_audio_get_current_time: (handle) => {
            const a = audios[handle]; return (a ? (a.currentTime || 0) : 0);
        }
,
        bindweb_audio_get_duration: (handle) => {
            const a = audios[handle]; return (a ? (a.duration || 0) : 0);
        }
,
        bindweb_websocket_connect: (url_ptr, url_len) => {
            const url = decoder.decode(new Uint8Array(memory.buffer, url_ptr, url_len));
            const ws = new WebSocket(url); const handle = allocHandle(ws); websockets[handle] = ws; ws.onmessage = (e) => push_event_websocket_MESSAGE(handle, e.data); ws.onopen = () => push_event_websocket_OPEN(handle); ws.onclose = () => { push_event_websocket_CLOSE(handle); websockets[handle] = undefined; }; ws.onerror = () => { push_event_websocket_ERROR(handle); websockets[handle] = undefined; }; return handle;
        }
,
        bindweb_fetch_get: (url_ptr, url_len, headers_ptr, headers_len) => {
            const url = decoder.decode(new Uint8Array(memory.buffer, url_ptr, url_len));
            const headers = decoder.decode(new Uint8Array(memory.buffer, headers_ptr, headers_len));
            let h = {}; try { h = JSON.parse(headers); } catch(e) {} fetch(url, { headers: h }).then(r => r.text().then(d => ({ ok: r.ok, status: r.status, statusText: r.statusText, data: d }))).then(res => { if(res.ok) push_event_fetch_SUCCESS(id, res.data); else push_event_fetch_ERROR(id, res.data && res.data.length ? res.data : (res.status + ' ' + res.statusText)); }).catch(e => push_event_fetch_ERROR(id, e.toString())); return id;
        }
,
        bindweb_fetch_post: (url_ptr, url_len, body_ptr, body_len, headers_ptr, headers_len) => {
            const url = decoder.decode(new Uint8Array(memory.buffer, url_ptr, url_len));
            const body = decoder.decode(new Uint8Array(memory.buffer, body_ptr, body_len));
            const headers = decoder.decode(new Uint8Array(memory.buffer, headers_ptr, headers_len));
            let h = {}; try { h = JSON.parse(headers); } catch(e) {} fetch(url, { method: 'POST', body: body, headers: h }).then(r => r.text().then(d => ({ ok: r.ok, status: r.status, statusText: r.statusText, data: d }))).then(res => { if(res.ok) push_event_fetch_SUCCESS(id, res.data); else push_event_fetch_ERROR(id, res.data && res.data.length ? res.data : (res.status + ' ' + res.statusText)); }).catch(e => push_event_fetch_ERROR(id, e.toString())); return id;
        }
,
        bindweb_fetch_patch: (url_ptr, url_len, body_ptr, body_len, headers_ptr, headers_len) => {
            const url = decoder.decode(new Uint8Array(memory.buffer, url_ptr, url_len));
            const body = decoder.decode(new Uint8Array(memory.buffer, body_ptr, body_len));
            const headers = decoder.decode(new Uint8Array(memory.buffer, headers_ptr, headers_len));
            let h = {}; try { h = JSON.parse(headers); } catch(e) {} fetch(url, { method: 'PATCH', body: body, headers: h }).then(r => r.text().then(d => ({ ok: r.ok, status: r.status, statusText: r.statusText, data: d }))).then(res => { if(res.ok) push_event_fetch_SUCCESS(id, res.data); else push_event_fetch_ERROR(id, res.data && res.data.length ? res.data : (res.status + ' ' + res.statusText)); }).catch(e => push_event_fetch_ERROR(id, e.toString())); return id;
        }
,
        bindweb_image_load: (src_ptr, src_len) => {
            const src = decoder.decode(new Uint8Array(memory.buffer, src_ptr, src_len));
            const img = new Image(); img.src = src; const handle = allocHandle(img); images[handle] = img; return handle;
        }
,
        bindweb_webgl_create_shader: (ctx_handle, type, source_ptr, source_len) => {
            const source = decoder.decode(new Uint8Array(memory.buffer, source_ptr, source_len));
            const gl = contexts[ctx_handle]; if(!gl) return -1; const s = gl.createShader(type); gl.shaderSource(s, source); gl.compileShader(s); if(!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(s)); const handle = allocHandle(s); webgl_shaders[handle] = s; return handle;
        }
,
        bindweb_webgl_create_program: (ctx_handle) => {
            const gl = contexts[ctx_handle]; if(!gl) return -1; const p = gl.createProgram(); const handle = allocHandle(p); webgl_programs[handle] = p; return handle;
        }
,
        bindweb_webgl_create_buffer: (ctx_handle) => {
            const gl = contexts[ctx_handle]; if(!gl) return -1; const b = gl.createBuffer(); const handle = allocHandle(b); webgl_buffers[handle] = b; return handle;
        }
,
        bindweb_webgl_get_uniform_location: (ctx_handle, prog_handle, name_ptr, name_len) => {
            const name = decoder.decode(new Uint8Array(memory.buffer, name_ptr, name_len));
            const gl = contexts[ctx_handle]; const p = webgl_programs[prog_handle]; if(!gl || !p) return -1; const loc = gl.getUniformLocation(p, name); if(!loc) console.warn('getUniformLocation failed:', name); const handle = allocHandle(loc); webgl_uniforms[handle] = loc; return handle;
        }
,
        bindweb_wgpu_get_queue: (device_handle) => {
            const d = webgpu_devices[device_handle]; if(!d) return -1; const h = allocHandle(d.queue); webgpu_queues[h] = d.queue; return h;
        }
,
        bindweb_wgpu_create_shader_module: (device_handle, code_ptr, code_len) => {
            const code = decoder.decode(new Uint8Array(memory.buffer, code_ptr, code_len));
            const d = webgpu_devices[device_handle]; if(!d) return -1; const sm = d.createShaderModule({ code: code }); const h = allocHandle(sm); webgpu_shaders[h] = sm; return h;
        }
,
        bindweb_wgpu_create_command_encoder: (device_handle) => {
            const d = webgpu_devices[device_handle]; if(!d) return -1; const ce = d.createCommandEncoder(); const h = allocHandle(ce); webgpu_encoders[h] = ce; return h;
        }
,
        bindweb_wgpu_get_current_texture_view: (context_handle) => {
            const ctx = contexts[context_handle]; if(!ctx) return -1; const v = ctx.getCurrentTexture().createView(); const h = allocHandle(v); webgpu_views[h] = v; return h;
        }
,
        bindweb_wgpu_begin_render_pass: (encoder_handle, view_handle, r, g, b, a) => {
            const enc = webgpu_encoders[encoder_handle]; const view = webgpu_views[view_handle]; if(!enc || !view) return -1; const rp = enc.beginRenderPass({ colorAttachments: [{ view: view, clearValue: {r, g, b, a}, loadOp: 'clear', storeOp: 'store' }] }); const h = allocHandle(rp); webgpu_passes[h] = rp; return h;
        }
,
        bindweb_wgpu_finish_encoder: (encoder_handle) => {
            const enc = webgpu_encoders[encoder_handle]; if(!enc) return -1; const buf = enc.finish(); const h = allocHandle(buf); webgpu_buffers[h] = buf; return h;
        }
,
        bindweb_wgpu_create_render_pipeline_simple: (device_handle, vs_module_handle, fs_module_handle, vs_entry_ptr, vs_entry_len, fs_entry_ptr, fs_entry_len, format_ptr, format_len) => {
            const vs_entry = decoder.decode(new Uint8Array(memory.buffer, vs_entry_ptr, vs_entry_len));
            const fs_entry = decoder.decode(new Uint8Array(memory.buffer, fs_entry_ptr, fs_entry_len));
            const format = decoder.decode(new Uint8Array(memory.buffer, format_ptr, format_len));
            const d = webgpu_devices[device_handle]; const vs = webgpu_shaders[vs_module_handle]; const fs = webgpu_shaders[fs_module_handle]; if(!d || !vs || !fs) return -1; const pl = d.createRenderPipeline({ layout: 'auto', vertex: { module: vs, entryPoint: vs_entry }, fragment: { module: fs, entryPoint: fs_entry, targets: [{ format: format === 'preferred' ? navigator.gpu.getPreferredCanvasFormat() : format }] }, primitive: { topology: 'triangle-list' } }); return h;
        }
    };


        function push_event_dom_CLICK(handle) {
        if (event_u8.buffer !== memory.buffer) refreshViews();
        if (event_offset_view[0] + 4096 > EVENT_BUFFER_SIZE) { console.warn('Event buffer full'); return; }
        let pos = event_offset_view[0]; const start_pos = pos;
        event_u8[pos] = 1; pos += 4;
        event_i32[pos >> 2] = handle; pos += 4;
        const len = pos - start_pos;
        event_u8[start_pos + 2] = len & 0xFF; event_u8[start_pos + 3] = (len >> 8) & 0xFF;
        event_offset_view[0] = pos;
    }

        function push_event_dom_INPUT(handle, value) {
        if (event_u8.buffer !== memory.buffer) refreshViews();
        if (event_offset_view[0] + 4096 > EVENT_BUFFER_SIZE) { console.warn('Event buffer full'); return; }
        let pos = event_offset_view[0]; const start_pos = pos;
        event_u8[pos] = 2; pos += 4;
        event_i32[pos >> 2] = handle; pos += 4;
        const enc1 = text_encoder.encode(value);
        event_i32[pos >> 2] = enc1.length; pos += 4;
        new Uint8Array(memory.buffer, event_buffer_ptr_val + pos).set(enc1); pos += (enc1.length + 3) & ~3;
        const len = pos - start_pos;
        event_u8[start_pos + 2] = len & 0xFF; event_u8[start_pos + 3] = (len >> 8) & 0xFF;
        event_offset_view[0] = pos;
    }

        function push_event_dom_CHANGE(handle, value) {
        if (event_u8.buffer !== memory.buffer) refreshViews();
        if (event_offset_view[0] + 4096 > EVENT_BUFFER_SIZE) { console.warn('Event buffer full'); return; }
        let pos = event_offset_view[0]; const start_pos = pos;
        event_u8[pos] = 3; pos += 4;
        event_i32[pos >> 2] = handle; pos += 4;
        const enc1 = text_encoder.encode(value);
        event_i32[pos >> 2] = enc1.length; pos += 4;
        new Uint8Array(memory.buffer, event_buffer_ptr_val + pos).set(enc1); pos += (enc1.length + 3) & ~3;
        const len = pos - start_pos;
        event_u8[start_pos + 2] = len & 0xFF; event_u8[start_pos + 3] = (len >> 8) & 0xFF;
        event_offset_view[0] = pos;
    }

        function push_event_dom_KEYDOWN(handle, keycode) {
        if (event_u8.buffer !== memory.buffer) refreshViews();
        if (event_offset_view[0] + 4096 > EVENT_BUFFER_SIZE) { console.warn('Event buffer full'); return; }
        let pos = event_offset_view[0]; const start_pos = pos;
        event_u8[pos] = 4; pos += 4;
        event_i32[pos >> 2] = handle; pos += 4;
        event_i32[pos >> 2] = keycode; pos += 4;
        const len = pos - start_pos;
        event_u8[start_pos + 2] = len & 0xFF; event_u8[start_pos + 3] = (len >> 8) & 0xFF;
        event_offset_view[0] = pos;
    }

        function push_event_input_KEY_DOWN(key_code) {
        if (event_u8.buffer !== memory.buffer) refreshViews();
        if (event_offset_view[0] + 4096 > EVENT_BUFFER_SIZE) { console.warn('Event buffer full'); return; }
        let pos = event_offset_view[0]; const start_pos = pos;
        event_u8[pos] = 5; pos += 4;
        event_i32[pos >> 2] = key_code; pos += 4;
        const len = pos - start_pos;
        event_u8[start_pos + 2] = len & 0xFF; event_u8[start_pos + 3] = (len >> 8) & 0xFF;
        event_offset_view[0] = pos;
    }

        function push_event_input_KEY_UP(key_code) {
        if (event_u8.buffer !== memory.buffer) refreshViews();
        if (event_offset_view[0] + 4096 > EVENT_BUFFER_SIZE) { console.warn('Event buffer full'); return; }
        let pos = event_offset_view[0]; const start_pos = pos;
        event_u8[pos] = 6; pos += 4;
        event_i32[pos >> 2] = key_code; pos += 4;
        const len = pos - start_pos;
        event_u8[start_pos + 2] = len & 0xFF; event_u8[start_pos + 3] = (len >> 8) & 0xFF;
        event_offset_view[0] = pos;
    }

        function push_event_input_MOUSE_DOWN(button, x, y) {
        if (event_u8.buffer !== memory.buffer) refreshViews();
        if (event_offset_view[0] + 4096 > EVENT_BUFFER_SIZE) { console.warn('Event buffer full'); return; }
        let pos = event_offset_view[0]; const start_pos = pos;
        event_u8[pos] = 7; pos += 4;
        event_i32[pos >> 2] = button; pos += 4;
        event_i32[pos >> 2] = x; pos += 4;
        event_i32[pos >> 2] = y; pos += 4;
        const len = pos - start_pos;
        event_u8[start_pos + 2] = len & 0xFF; event_u8[start_pos + 3] = (len >> 8) & 0xFF;
        event_offset_view[0] = pos;
    }

        function push_event_input_MOUSE_UP(button, x, y) {
        if (event_u8.buffer !== memory.buffer) refreshViews();
        if (event_offset_view[0] + 4096 > EVENT_BUFFER_SIZE) { console.warn('Event buffer full'); return; }
        let pos = event_offset_view[0]; const start_pos = pos;
        event_u8[pos] = 8; pos += 4;
        event_i32[pos >> 2] = button; pos += 4;
        event_i32[pos >> 2] = x; pos += 4;
        event_i32[pos >> 2] = y; pos += 4;
        const len = pos - start_pos;
        event_u8[start_pos + 2] = len & 0xFF; event_u8[start_pos + 3] = (len >> 8) & 0xFF;
        event_offset_view[0] = pos;
    }

        function push_event_input_MOUSE_MOVE(x, y) {
        if (event_u8.buffer !== memory.buffer) refreshViews();
        if (event_offset_view[0] + 4096 > EVENT_BUFFER_SIZE) { console.warn('Event buffer full'); return; }
        let pos = event_offset_view[0]; const start_pos = pos;
        event_u8[pos] = 9; pos += 4;
        event_i32[pos >> 2] = x; pos += 4;
        event_i32[pos >> 2] = y; pos += 4;
        const len = pos - start_pos;
        event_u8[start_pos + 2] = len & 0xFF; event_u8[start_pos + 3] = (len >> 8) & 0xFF;
        event_offset_view[0] = pos;
    }

        function push_event_system_POPSTATE(path) {
        if (event_u8.buffer !== memory.buffer) refreshViews();
        if (event_offset_view[0] + 4096 > EVENT_BUFFER_SIZE) { console.warn('Event buffer full'); return; }
        let pos = event_offset_view[0]; const start_pos = pos;
        event_u8[pos] = 10; pos += 4;
        const enc0 = text_encoder.encode(path);
        event_i32[pos >> 2] = enc0.length; pos += 4;
        new Uint8Array(memory.buffer, event_buffer_ptr_val + pos).set(enc0); pos += (enc0.length + 3) & ~3;
        const len = pos - start_pos;
        event_u8[start_pos + 2] = len & 0xFF; event_u8[start_pos + 3] = (len >> 8) & 0xFF;
        event_offset_view[0] = pos;
    }

        function push_event_system_VISIBILITY_CHANGE(hidden, state) {
        if (event_u8.buffer !== memory.buffer) refreshViews();
        if (event_offset_view[0] + 4096 > EVENT_BUFFER_SIZE) { console.warn('Event buffer full'); return; }
        let pos = event_offset_view[0]; const start_pos = pos;
        event_u8[pos] = 11; pos += 4;
        event_i32[pos >> 2] = hidden; pos += 4;
        const enc1 = text_encoder.encode(state);
        event_i32[pos >> 2] = enc1.length; pos += 4;
        new Uint8Array(memory.buffer, event_buffer_ptr_val + pos).set(enc1); pos += (enc1.length + 3) & ~3;
        const len = pos - start_pos;
        event_u8[start_pos + 2] = len & 0xFF; event_u8[start_pos + 3] = (len >> 8) & 0xFF;
        event_offset_view[0] = pos;
    }

        function push_event_websocket_MESSAGE(handle, data) {
        if (event_u8.buffer !== memory.buffer) refreshViews();
        if (event_offset_view[0] + 4096 > EVENT_BUFFER_SIZE) { console.warn('Event buffer full'); return; }
        let pos = event_offset_view[0]; const start_pos = pos;
        event_u8[pos] = 12; pos += 4;
        event_i32[pos >> 2] = handle; pos += 4;
        const enc1 = text_encoder.encode(data);
        event_i32[pos >> 2] = enc1.length; pos += 4;
        new Uint8Array(memory.buffer, event_buffer_ptr_val + pos).set(enc1); pos += (enc1.length + 3) & ~3;
        const len = pos - start_pos;
        event_u8[start_pos + 2] = len & 0xFF; event_u8[start_pos + 3] = (len >> 8) & 0xFF;
        event_offset_view[0] = pos;
    }

        function push_event_websocket_OPEN(handle) {
        if (event_u8.buffer !== memory.buffer) refreshViews();
        if (event_offset_view[0] + 4096 > EVENT_BUFFER_SIZE) { console.warn('Event buffer full'); return; }
        let pos = event_offset_view[0]; const start_pos = pos;
        event_u8[pos] = 13; pos += 4;
        event_i32[pos >> 2] = handle; pos += 4;
        const len = pos - start_pos;
        event_u8[start_pos + 2] = len & 0xFF; event_u8[start_pos + 3] = (len >> 8) & 0xFF;
        event_offset_view[0] = pos;
    }

        function push_event_websocket_CLOSE(handle) {
        if (event_u8.buffer !== memory.buffer) refreshViews();
        if (event_offset_view[0] + 4096 > EVENT_BUFFER_SIZE) { console.warn('Event buffer full'); return; }
        let pos = event_offset_view[0]; const start_pos = pos;
        event_u8[pos] = 14; pos += 4;
        event_i32[pos >> 2] = handle; pos += 4;
        const len = pos - start_pos;
        event_u8[start_pos + 2] = len & 0xFF; event_u8[start_pos + 3] = (len >> 8) & 0xFF;
        event_offset_view[0] = pos;
    }

        function push_event_websocket_ERROR(handle) {
        if (event_u8.buffer !== memory.buffer) refreshViews();
        if (event_offset_view[0] + 4096 > EVENT_BUFFER_SIZE) { console.warn('Event buffer full'); return; }
        let pos = event_offset_view[0]; const start_pos = pos;
        event_u8[pos] = 15; pos += 4;
        event_i32[pos >> 2] = handle; pos += 4;
        const len = pos - start_pos;
        event_u8[start_pos + 2] = len & 0xFF; event_u8[start_pos + 3] = (len >> 8) & 0xFF;
        event_offset_view[0] = pos;
    }

        function push_event_fetch_SUCCESS(id, data) {
        if (event_u8.buffer !== memory.buffer) refreshViews();
        if (event_offset_view[0] + 4096 > EVENT_BUFFER_SIZE) { console.warn('Event buffer full'); return; }
        let pos = event_offset_view[0]; const start_pos = pos;
        event_u8[pos] = 16; pos += 4;
        event_i32[pos >> 2] = id; pos += 4;
        const enc1 = text_encoder.encode(data);
        event_i32[pos >> 2] = enc1.length; pos += 4;
        new Uint8Array(memory.buffer, event_buffer_ptr_val + pos).set(enc1); pos += (enc1.length + 3) & ~3;
        const len = pos - start_pos;
        event_u8[start_pos + 2] = len & 0xFF; event_u8[start_pos + 3] = (len >> 8) & 0xFF;
        event_offset_view[0] = pos;
    }

        function push_event_fetch_ERROR(id, error) {
        if (event_u8.buffer !== memory.buffer) refreshViews();
        if (event_offset_view[0] + 4096 > EVENT_BUFFER_SIZE) { console.warn('Event buffer full'); return; }
        let pos = event_offset_view[0]; const start_pos = pos;
        event_u8[pos] = 17; pos += 4;
        event_i32[pos >> 2] = id; pos += 4;
        const enc1 = text_encoder.encode(error);
        event_i32[pos >> 2] = enc1.length; pos += 4;
        new Uint8Array(memory.buffer, event_buffer_ptr_val + pos).set(enc1); pos += (enc1.length + 3) & ~3;
        const len = pos - start_pos;
        event_u8[start_pos + 2] = len & 0xFF; event_u8[start_pos + 3] = (len >> 8) & 0xFF;
        event_offset_view[0] = pos;
    }

        function push_event_wgpu_ADAPTER_READY(handle) {
        if (event_u8.buffer !== memory.buffer) refreshViews();
        if (event_offset_view[0] + 4096 > EVENT_BUFFER_SIZE) { console.warn('Event buffer full'); return; }
        let pos = event_offset_view[0]; const start_pos = pos;
        event_u8[pos] = 18; pos += 4;
        event_i32[pos >> 2] = handle; pos += 4;
        const len = pos - start_pos;
        event_u8[start_pos + 2] = len & 0xFF; event_u8[start_pos + 3] = (len >> 8) & 0xFF;
        event_offset_view[0] = pos;
    }

        function push_event_wgpu_DEVICE_READY(handle) {
        if (event_u8.buffer !== memory.buffer) refreshViews();
        if (event_offset_view[0] + 4096 > EVENT_BUFFER_SIZE) { console.warn('Event buffer full'); return; }
        let pos = event_offset_view[0]; const start_pos = pos;
        event_u8[pos] = 19; pos += 4;
        event_i32[pos >> 2] = handle; pos += 4;
        const len = pos - start_pos;
        event_u8[start_pos + 2] = len & 0xFF; event_u8[start_pos + 3] = (len >> 8) & 0xFF;
        event_offset_view[0] = pos;
    }

        function push_event_input_MOUSE_WHEEL(delta_x, delta_y) {
        if (event_u8.buffer !== memory.buffer) refreshViews();
        if (event_offset_view[0] + 4096 > EVENT_BUFFER_SIZE) { console.warn('Event buffer full'); return; }
        let pos = event_offset_view[0]; const start_pos = pos;
        event_u8[pos] = 20; pos += 4;
        event_i32[pos >> 2] = delta_x; pos += 4;
        event_i32[pos >> 2] = delta_y; pos += 4;
        const len = pos - start_pos;
        event_u8[start_pos + 2] = len & 0xFF; event_u8[start_pos + 3] = (len >> 8) & 0xFF;
        event_offset_view[0] = pos;
    }

        function push_event_input_RESIZE(width, height) {
        if (event_u8.buffer !== memory.buffer) refreshViews();
        if (event_offset_view[0] + 4096 > EVENT_BUFFER_SIZE) { console.warn('Event buffer full'); return; }
        let pos = event_offset_view[0]; const start_pos = pos;
        event_u8[pos] = 21; pos += 4;
        event_i32[pos >> 2] = width; pos += 4;
        event_i32[pos >> 2] = height; pos += 4;
        const len = pos - start_pos;
        event_u8[start_pos + 2] = len & 0xFF; event_u8[start_pos + 3] = (len >> 8) & 0xFF;
        event_offset_view[0] = pos;
    }

    // -- Flush: processes commands from WASM memory --
    function flush(ptr, size) {
        if (size === 0) return;
        if (!memory) { console.error('[bindweb] flush before connect'); return; }
        if (u8.buffer !== memory.buffer) refreshViews();
        let pos = ptr, end = ptr + size;
        while (pos < end) {
            if (pos + 4 > end) break;
            const opcode = i32[pos >> 2]; pos += 4;
            switch (opcode) {

                case 5: {
                    if (pos + 4 > end) break;
                    const handle = i32[pos >> 2]; pos += 4;
                    if (pos + 4 > end) break;
                    const tag_len = i32[pos >> 2]; pos += 4;
                    const tag_pad = (tag_len + 3) & ~3;
                    if (pos + tag_pad > end) break;
                    const tag = decoder.decode(u8.subarray(pos, pos + tag_len)); pos += tag_pad;
                    const el = document.createElement(tag); elements[handle] = el;
                    break;
                }

                case 6: {
                    if (pos + 4 > end) break;
                    const handle = i32[pos >> 2]; pos += 4;
                    if (pos + 4 > end) break;
                    const tag_len = i32[pos >> 2]; pos += 4;
                    const tag_pad = (tag_len + 3) & ~3;
                    if (pos + tag_pad > end) break;
                    const tag = decoder.decode(u8.subarray(pos, pos + tag_len)); pos += tag_pad;
                    if (pos + 4 > end) break;
                    const scope_len = i32[pos >> 2]; pos += 4;
                    const scope_pad = (scope_len + 3) & ~3;
                    if (pos + scope_pad > end) break;
                    const scope = decoder.decode(u8.subarray(pos, pos + scope_len)); pos += scope_pad;
                    const el = document.createElement(tag); el.setAttribute('coi-scope', scope); elements[handle] = el;
                    break;
                }

                case 8: {
                    if (pos + 4 > end) break;
                    const handle = i32[pos >> 2]; pos += 4;
                    if (pos + 4 > end) break;
                    const text_len = i32[pos >> 2]; pos += 4;
                    const text_pad = (text_len + 3) & ~3;
                    if (pos + text_pad > end) break;
                    const text = decoder.decode(u8.subarray(pos, pos + text_len)); pos += text_pad;
                    const el = document.createComment(text); elements[handle] = el;
                    break;
                }

                case 10: {
                    if (pos + 4 > end) break;
                    const handle = i32[pos >> 2]; pos += 4;
                    if (pos + 4 > end) break;
                    const text_len = i32[pos >> 2]; pos += 4;
                    const text_pad = (text_len + 3) & ~3;
                    if (pos + text_pad > end) break;
                    const text = decoder.decode(u8.subarray(pos, pos + text_len)); pos += text_pad;
                    const el = document.createTextNode(text); elements[handle] = el;
                    break;
                }

                case 11: {
                    if (pos + 4 > end) break;
                    const handle = i32[pos >> 2]; pos += 4;
                    if (pos + 4 > end) break;
                    const text_len = i32[pos >> 2]; pos += 4;
                    const text_pad = (text_len + 3) & ~3;
                    if (pos + text_pad > end) break;
                    const text = decoder.decode(u8.subarray(pos, pos + text_len)); pos += text_pad;
                    const el = elements[handle]; if(el) el.nodeValue = text;
                    break;
                }

                case 12: {
                    if (pos + 4 > end) break;
                    const handle = i32[pos >> 2]; pos += 4;
                    if (pos + 4 > end) break;
                    const name_len = i32[pos >> 2]; pos += 4;
                    const name_pad = (name_len + 3) & ~3;
                    if (pos + name_pad > end) break;
                    const name = decoder.decode(u8.subarray(pos, pos + name_len)); pos += name_pad;
                    if (pos + 4 > end) break;
                    const value_len = i32[pos >> 2]; pos += 4;
                    const value_pad = (value_len + 3) & ~3;
                    if (pos + value_pad > end) break;
                    const value = decoder.decode(u8.subarray(pos, pos + value_len)); pos += value_pad;
                    const el = elements[handle]; if(!el){ console.warn('set_attribute: unknown element handle', handle); continue; } el.setAttribute(name, value);
                    break;
                }

                case 13: {
                    if (pos + 4 > end) break;
                    const handle = i32[pos >> 2]; pos += 4;
                    if (pos + 4 > end) break;
                    const name_len = i32[pos >> 2]; pos += 4;
                    const name_pad = (name_len + 3) & ~3;
                    if (pos + name_pad > end) break;
                    const name = decoder.decode(u8.subarray(pos, pos + name_len)); pos += name_pad;
                    if (pos + 4 > end) break;
                    const value_len = i32[pos >> 2]; pos += 4;
                    const value_pad = (value_len + 3) & ~3;
                    if (pos + value_pad > end) break;
                    const value = decoder.decode(u8.subarray(pos, pos + value_len)); pos += value_pad;
                    const el = elements[handle]; if(!el){ console.warn('set_property: unknown element handle', handle); continue; } el[name] = value;
                    break;
                }

                case 15: {
                    if (pos + 4 > end) break;
                    const parent_handle = i32[pos >> 2]; pos += 4;
                    if (pos + 4 > end) break;
                    const child_handle = i32[pos >> 2]; pos += 4;
                    const parent = elements[parent_handle]; const child = elements[child_handle]; if(!parent || !child){ console.warn('append_child: unknown handles', parent_handle, child_handle); continue; } parent.appendChild(child);
                    break;
                }

                case 16: {
                    if (pos + 4 > end) break;
                    const parent_handle = i32[pos >> 2]; pos += 4;
                    if (pos + 4 > end) break;
                    const child_handle = i32[pos >> 2]; pos += 4;
                    if (pos + 4 > end) break;
                    const ref_handle = i32[pos >> 2]; pos += 4;
                    const parent = elements[parent_handle]; const child = elements[child_handle]; const ref = elements[ref_handle]; if(!parent || !child){ console.warn('insert_before: unknown handles', parent_handle, child_handle); continue; } parent.insertBefore(child, ref || null);
                    break;
                }

                case 17: {
                    if (pos + 4 > end) break;
                    const handle = i32[pos >> 2]; pos += 4;
                    const el = elements[handle]; if(!el){ console.warn('remove_element: unknown element handle', handle); continue; } el.remove(); releaseHandle(handle);
                    break;
                }

                case 18: {
                    if (pos + 4 > end) break;
                    const parent_handle = i32[pos >> 2]; pos += 4;
                    if (pos + 4 > end) break;
                    const node_handle = i32[pos >> 2]; pos += 4;
                    if (pos + 4 > end) break;
                    const ref_handle = i32[pos >> 2]; pos += 4;
                    const parent = elements[parent_handle]; const node = elements[node_handle]; const ref = elements[ref_handle]; if(!parent || !node){ console.warn('move_before: unknown handles', parent_handle, node_handle); continue; } parent.insertBefore(node, ref || null);
                    break;
                }

                case 19: {
                    if (pos + 4 > end) break;
                    const handle = i32[pos >> 2]; pos += 4;
                    if (pos + 4 > end) break;
                    const html_len = i32[pos >> 2]; pos += 4;
                    const html_pad = (html_len + 3) & ~3;
                    if (pos + html_pad > end) break;
                    const html = decoder.decode(u8.subarray(pos, pos + html_len)); pos += html_pad;
                    const el = elements[handle]; if(el) el.innerHTML = html;
                    break;
                }

                case 20: {
                    if (pos + 4 > end) break;
                    const handle = i32[pos >> 2]; pos += 4;
                    if (pos + 4 > end) break;
                    const text_len = i32[pos >> 2]; pos += 4;
                    const text_pad = (text_len + 3) & ~3;
                    if (pos + text_pad > end) break;
                    const text = decoder.decode(u8.subarray(pos, pos + text_len)); pos += text_pad;
                    const el = elements[handle]; if(el) el.innerText = text;
                    break;
                }

                case 21: {
                    if (pos + 4 > end) break;
                    const handle = i32[pos >> 2]; pos += 4;
                    if (pos + 4 > end) break;
                    const cls_len = i32[pos >> 2]; pos += 4;
                    const cls_pad = (cls_len + 3) & ~3;
                    if (pos + cls_pad > end) break;
                    const cls = decoder.decode(u8.subarray(pos, pos + cls_len)); pos += cls_pad;
                    const el = elements[handle]; if(el) el.classList.add(cls);
                    break;
                }

                case 22: {
                    if (pos + 4 > end) break;
                    const handle = i32[pos >> 2]; pos += 4;
                    if (pos + 4 > end) break;
                    const cls_len = i32[pos >> 2]; pos += 4;
                    const cls_pad = (cls_len + 3) & ~3;
                    if (pos + cls_pad > end) break;
                    const cls = decoder.decode(u8.subarray(pos, pos + cls_len)); pos += cls_pad;
                    const el = elements[handle]; if(el) el.classList.remove(cls);
                    break;
                }

                case 23: {
                    if (pos + 4 > end) break;
                    const handle = i32[pos >> 2]; pos += 4;
                    const el = elements[handle]; if(el) el.dataset.c = handle;
                    break;
                }

                case 24: {
                    if (pos + 4 > end) break;
                    const handle = i32[pos >> 2]; pos += 4;
                    const el = elements[handle]; if(el) el.dataset.i = handle;
                    break;
                }

                case 25: {
                    if (pos + 4 > end) break;
                    const handle = i32[pos >> 2]; pos += 4;
                    const el = elements[handle]; if(el) el.dataset.g = handle;
                    break;
                }

                case 26: {
                    if (pos + 4 > end) break;
                    const handle = i32[pos >> 2]; pos += 4;
                    const el = elements[handle]; if(el) el.dataset.k = handle;
                    break;
                }

                case 27: {
                    if (pos + 4 > end) break;
                    const handle = i32[pos >> 2]; pos += 4;
                    const el = elements[handle] || document.body; el.requestFullscreen().catch(console.error);
                    break;
                }

                case 28: {
                    if (pos + 4 > end) break;
                    const handle = i32[pos >> 2]; pos += 4;
                    const el = elements[handle] || document.body; el.requestPointerLock();
                    break;
                }

                case 29: {
                    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
                    break;
                }

                case 34: {
                    if (pos + 4 > end) break;
                    const handle = i32[pos >> 2]; pos += 4;
                    if (pos % 8 !== 0) pos += (8 - (pos % 8));
                    if (pos + 8 > end) break;
                    const width = f64[pos >> 3]; pos += 8;
                    if (pos % 8 !== 0) pos += (8 - (pos % 8));
                    if (pos + 8 > end) break;
                    const height = f64[pos >> 3]; pos += 8;
                    const c = elements[handle]; if(c) { c.width = width; c.height = height; }
                    break;
                }

                case 35: {
                    if (pos + 4 > end) break;
                    const handle = i32[pos >> 2]; pos += 4;
                    if (pos + 4 > end) break;
                    const r = i32[pos >> 2]; pos += 4;
                    if (pos + 4 > end) break;
                    const g = i32[pos >> 2]; pos += 4;
                    if (pos + 4 > end) break;
                    const b = i32[pos >> 2]; pos += 4;
                    const ctx = contexts[handle]; if(!ctx){ console.warn('set_fill_style: unknown context', handle); continue; } ctx.fillStyle = `rgb(${r},${g},${b})`;
                    break;
                }

                case 36: {
                    if (pos + 4 > end) break;
                    const handle = i32[pos >> 2]; pos += 4;
                    if (pos + 4 > end) break;
                    const color_len = i32[pos >> 2]; pos += 4;
                    const color_pad = (color_len + 3) & ~3;
                    if (pos + color_pad > end) break;
                    const color = decoder.decode(u8.subarray(pos, pos + color_len)); pos += color_pad;
                    const ctx = contexts[handle]; if(ctx) ctx.fillStyle = color;
                    break;
                }

                case 37: {
                    if (pos + 4 > end) break;
                    const handle = i32[pos >> 2]; pos += 4;
                    if (pos % 8 !== 0) pos += (8 - (pos % 8));
                    if (pos + 8 > end) break;
                    const x = f64[pos >> 3]; pos += 8;
                    if (pos % 8 !== 0) pos += (8 - (pos % 8));
                    if (pos + 8 > end) break;
                    const y = f64[pos >> 3]; pos += 8;
                    if (pos % 8 !== 0) pos += (8 - (pos % 8));
                    if (pos + 8 > end) break;
                    const w = f64[pos >> 3]; pos += 8;
                    if (pos % 8 !== 0) pos += (8 - (pos % 8));
                    if (pos + 8 > end) break;
                    const h = f64[pos >> 3]; pos += 8;
                    const ctx = contexts[handle]; if(!ctx){ console.warn('fill_rect: unknown context', handle); continue; } ctx.fillRect(x, y, w, h);
                    break;
                }

                case 38: {
                    if (pos + 4 > end) break;
                    const handle = i32[pos >> 2]; pos += 4;
                    if (pos % 8 !== 0) pos += (8 - (pos % 8));
                    if (pos + 8 > end) break;
                    const x = f64[pos >> 3]; pos += 8;
                    if (pos % 8 !== 0) pos += (8 - (pos % 8));
                    if (pos + 8 > end) break;
                    const y = f64[pos >> 3]; pos += 8;
                    if (pos % 8 !== 0) pos += (8 - (pos % 8));
                    if (pos + 8 > end) break;
                    const w = f64[pos >> 3]; pos += 8;
                    if (pos % 8 !== 0) pos += (8 - (pos % 8));
                    if (pos + 8 > end) break;
                    const h = f64[pos >> 3]; pos += 8;
                    const ctx = contexts[handle]; if(!ctx){ console.warn('clear_canvas: unknown context', handle); continue; } ctx.clearRect(x, y, w, h);
                    break;
                }

                case 39: {
                    if (pos + 4 > end) break;
                    const handle = i32[pos >> 2]; pos += 4;
                    if (pos % 8 !== 0) pos += (8 - (pos % 8));
                    if (pos + 8 > end) break;
                    const x = f64[pos >> 3]; pos += 8;
                    if (pos % 8 !== 0) pos += (8 - (pos % 8));
                    if (pos + 8 > end) break;
                    const y = f64[pos >> 3]; pos += 8;
                    if (pos % 8 !== 0) pos += (8 - (pos % 8));
                    if (pos + 8 > end) break;
                    const w = f64[pos >> 3]; pos += 8;
                    if (pos % 8 !== 0) pos += (8 - (pos % 8));
                    if (pos + 8 > end) break;
                    const h = f64[pos >> 3]; pos += 8;
                    const ctx = contexts[handle]; if(!ctx){ console.warn('stroke_rect: unknown context', handle); continue; } ctx.strokeRect(x, y, w, h);
                    break;
                }

                case 40: {
                    if (pos + 4 > end) break;
                    const handle = i32[pos >> 2]; pos += 4;
                    if (pos + 4 > end) break;
                    const r = i32[pos >> 2]; pos += 4;
                    if (pos + 4 > end) break;
                    const g = i32[pos >> 2]; pos += 4;
                    if (pos + 4 > end) break;
                    const b = i32[pos >> 2]; pos += 4;
                    const ctx = contexts[handle]; if(!ctx){ console.warn('set_stroke_style: unknown context', handle); continue; } ctx.strokeStyle = `rgb(${r},${g},${b})`;
                    break;
                }

                case 41: {
                    if (pos + 4 > end) break;
                    const handle = i32[pos >> 2]; pos += 4;
                    if (pos + 4 > end) break;
                    const color_len = i32[pos >> 2]; pos += 4;
                    const color_pad = (color_len + 3) & ~3;
                    if (pos + color_pad > end) break;
                    const color = decoder.decode(u8.subarray(pos, pos + color_len)); pos += color_pad;
                    const ctx = contexts[handle]; if(ctx) ctx.strokeStyle = color;
                    break;
                }

                case 42: {
                    if (pos + 4 > end) break;
                    const handle = i32[pos >> 2]; pos += 4;
                    if (pos % 8 !== 0) pos += (8 - (pos % 8));
                    if (pos + 8 > end) break;
                    const width = f64[pos >> 3]; pos += 8;
                    const ctx = contexts[handle]; if(ctx) ctx.lineWidth = width;
                    break;
                }

                case 43: {
                    if (pos + 4 > end) break;
                    const handle = i32[pos >> 2]; pos += 4;
                    const ctx = contexts[handle]; if(!ctx){ console.warn('begin_path: unknown context', handle); continue; } ctx.beginPath();
                    break;
                }

                case 44: {
                    if (pos + 4 > end) break;
                    const handle = i32[pos >> 2]; pos += 4;
                    const ctx = contexts[handle]; if(ctx) ctx.closePath();
                    break;
                }

                case 45: {
                    if (pos + 4 > end) break;
                    const handle = i32[pos >> 2]; pos += 4;
                    if (pos % 8 !== 0) pos += (8 - (pos % 8));
                    if (pos + 8 > end) break;
                    const x = f64[pos >> 3]; pos += 8;
                    if (pos % 8 !== 0) pos += (8 - (pos % 8));
                    if (pos + 8 > end) break;
                    const y = f64[pos >> 3]; pos += 8;
                    const ctx = contexts[handle]; if(!ctx){ console.warn('move_to: unknown context', handle); continue; } ctx.moveTo(x, y);
                    break;
                }

                case 46: {
                    if (pos + 4 > end) break;
                    const handle = i32[pos >> 2]; pos += 4;
                    if (pos % 8 !== 0) pos += (8 - (pos % 8));
                    if (pos + 8 > end) break;
                    const x = f64[pos >> 3]; pos += 8;
                    if (pos % 8 !== 0) pos += (8 - (pos % 8));
                    if (pos + 8 > end) break;
                    const y = f64[pos >> 3]; pos += 8;
                    const ctx = contexts[handle]; if(!ctx){ console.warn('line_to: unknown context', handle); continue; } ctx.lineTo(x, y);
                    break;
                }

                case 47: {
                    if (pos + 4 > end) break;
                    const handle = i32[pos >> 2]; pos += 4;
                    const ctx = contexts[handle]; if(!ctx){ console.warn('stroke: unknown context', handle); continue; } ctx.stroke();
                    break;
                }

                case 48: {
                    if (pos + 4 > end) break;
                    const handle = i32[pos >> 2]; pos += 4;
                    const ctx = contexts[handle]; if(!ctx){ console.warn('fill: unknown context', handle); continue; } ctx.fill();
                    break;
                }

                case 49: {
                    if (pos + 4 > end) break;
                    const handle = i32[pos >> 2]; pos += 4;
                    if (pos % 8 !== 0) pos += (8 - (pos % 8));
                    if (pos + 8 > end) break;
                    const x = f64[pos >> 3]; pos += 8;
                    if (pos % 8 !== 0) pos += (8 - (pos % 8));
                    if (pos + 8 > end) break;
                    const y = f64[pos >> 3]; pos += 8;
                    if (pos % 8 !== 0) pos += (8 - (pos % 8));
                    if (pos + 8 > end) break;
                    const radius = f64[pos >> 3]; pos += 8;
                    if (pos % 8 !== 0) pos += (8 - (pos % 8));
                    if (pos + 8 > end) break;
                    const start_angle = f64[pos >> 3]; pos += 8;
                    if (pos % 8 !== 0) pos += (8 - (pos % 8));
                    if (pos + 8 > end) break;
                    const end_angle = f64[pos >> 3]; pos += 8;
                    const ctx = contexts[handle]; if(!ctx){ console.warn('arc: unknown context', handle); continue; } ctx.arc(x, y, radius, start_angle, end_angle);
                    break;
                }

                case 50: {
                    if (pos + 4 > end) break;
                    const handle = i32[pos >> 2]; pos += 4;
                    if (pos + 4 > end) break;
                    const text_len = i32[pos >> 2]; pos += 4;
                    const text_pad = (text_len + 3) & ~3;
                    if (pos + text_pad > end) break;
                    const text = decoder.decode(u8.subarray(pos, pos + text_len)); pos += text_pad;
                    if (pos % 8 !== 0) pos += (8 - (pos % 8));
                    if (pos + 8 > end) break;
                    const x = f64[pos >> 3]; pos += 8;
                    if (pos % 8 !== 0) pos += (8 - (pos % 8));
                    if (pos + 8 > end) break;
                    const y = f64[pos >> 3]; pos += 8;
                    const ctx = contexts[handle]; if(ctx) ctx.fillText(text, x, y);
                    break;
                }

                case 51: {
                    if (pos + 4 > end) break;
                    const handle = i32[pos >> 2]; pos += 4;
                    if (pos + 4 > end) break;
                    const fmt_len = i32[pos >> 2]; pos += 4;
                    const fmt_pad = (fmt_len + 3) & ~3;
                    if (pos + fmt_pad > end) break;
                    const fmt = decoder.decode(u8.subarray(pos, pos + fmt_len)); pos += fmt_pad;
                    if (pos % 8 !== 0) pos += (8 - (pos % 8));
                    if (pos + 8 > end) break;
                    const val = f64[pos >> 3]; pos += 8;
                    if (pos % 8 !== 0) pos += (8 - (pos % 8));
                    if (pos + 8 > end) break;
                    const x = f64[pos >> 3]; pos += 8;
                    if (pos % 8 !== 0) pos += (8 - (pos % 8));
                    if (pos + 8 > end) break;
                    const y = f64[pos >> 3]; pos += 8;
                    const ctx = contexts[handle]; if(ctx) ctx.fillText(fmt.replace('%f', val.toFixed(2)), x, y);
                    break;
                }

                case 52: {
                    if (pos + 4 > end) break;
                    const handle = i32[pos >> 2]; pos += 4;
                    if (pos + 4 > end) break;
                    const fmt_len = i32[pos >> 2]; pos += 4;
                    const fmt_pad = (fmt_len + 3) & ~3;
                    if (pos + fmt_pad > end) break;
                    const fmt = decoder.decode(u8.subarray(pos, pos + fmt_len)); pos += fmt_pad;
                    if (pos + 4 > end) break;
                    const val = i32[pos >> 2]; pos += 4;
                    if (pos % 8 !== 0) pos += (8 - (pos % 8));
                    if (pos + 8 > end) break;
                    const x = f64[pos >> 3]; pos += 8;
                    if (pos % 8 !== 0) pos += (8 - (pos % 8));
                    if (pos + 8 > end) break;
                    const y = f64[pos >> 3]; pos += 8;
                    const ctx = contexts[handle]; if(ctx) ctx.fillText(fmt.replace('%d', val), x, y);
                    break;
                }

                case 53: {
                    if (pos + 4 > end) break;
                    const handle = i32[pos >> 2]; pos += 4;
                    if (pos + 4 > end) break;
                    const font_len = i32[pos >> 2]; pos += 4;
                    const font_pad = (font_len + 3) & ~3;
                    if (pos + font_pad > end) break;
                    const font = decoder.decode(u8.subarray(pos, pos + font_len)); pos += font_pad;
                    const ctx = contexts[handle]; if(ctx) ctx.font = font;
                    break;
                }

                case 54: {
                    if (pos + 4 > end) break;
                    const handle = i32[pos >> 2]; pos += 4;
                    if (pos + 4 > end) break;
                    const align_len = i32[pos >> 2]; pos += 4;
                    const align_pad = (align_len + 3) & ~3;
                    if (pos + align_pad > end) break;
                    const align = decoder.decode(u8.subarray(pos, pos + align_len)); pos += align_pad;
                    const ctx = contexts[handle]; if(ctx) ctx.textAlign = align;
                    break;
                }

                case 55: {
                    if (pos + 4 > end) break;
                    const handle = i32[pos >> 2]; pos += 4;
                    if (pos + 4 > end) break;
                    const img_handle = i32[pos >> 2]; pos += 4;
                    if (pos % 8 !== 0) pos += (8 - (pos % 8));
                    if (pos + 8 > end) break;
                    const x = f64[pos >> 3]; pos += 8;
                    if (pos % 8 !== 0) pos += (8 - (pos % 8));
                    if (pos + 8 > end) break;
                    const y = f64[pos >> 3]; pos += 8;
                    const ctx = contexts[handle]; const img = images[img_handle]; if(ctx && img) ctx.drawImage(img, x, y);
                    break;
                }

                case 56: {
                    if (pos + 4 > end) break;
                    const handle = i32[pos >> 2]; pos += 4;
                    if (pos % 8 !== 0) pos += (8 - (pos % 8));
                    if (pos + 8 > end) break;
                    const x = f64[pos >> 3]; pos += 8;
                    if (pos % 8 !== 0) pos += (8 - (pos % 8));
                    if (pos + 8 > end) break;
                    const y = f64[pos >> 3]; pos += 8;
                    const ctx = contexts[handle]; if(ctx) ctx.translate(x, y);
                    break;
                }

                case 57: {
                    if (pos + 4 > end) break;
                    const handle = i32[pos >> 2]; pos += 4;
                    if (pos % 8 !== 0) pos += (8 - (pos % 8));
                    if (pos + 8 > end) break;
                    const angle = f64[pos >> 3]; pos += 8;
                    const ctx = contexts[handle]; if(ctx) ctx.rotate(angle);
                    break;
                }

                case 58: {
                    if (pos + 4 > end) break;
                    const handle = i32[pos >> 2]; pos += 4;
                    if (pos % 8 !== 0) pos += (8 - (pos % 8));
                    if (pos + 8 > end) break;
                    const x = f64[pos >> 3]; pos += 8;
                    if (pos % 8 !== 0) pos += (8 - (pos % 8));
                    if (pos + 8 > end) break;
                    const y = f64[pos >> 3]; pos += 8;
                    const ctx = contexts[handle]; if(ctx) ctx.scale(x, y);
                    break;
                }

                case 59: {
                    if (pos + 4 > end) break;
                    const handle = i32[pos >> 2]; pos += 4;
                    const ctx = contexts[handle]; if(ctx) ctx.save();
                    break;
                }

                case 60: {
                    if (pos + 4 > end) break;
                    const handle = i32[pos >> 2]; pos += 4;
                    const ctx = contexts[handle]; if(ctx) ctx.restore();
                    break;
                }

                case 61: {
                    if (pos + 4 > end) break;
                    const handle = i32[pos >> 2]; pos += 4;
                    const cv = elements[handle]; if(!cv){ console.warn('log_canvas_info: unknown canvas handle', handle); continue; } console.log('Canvas', handle, 'size:', cv.width, 'x', cv.height);
                    break;
                }

                case 62: {
                    if (pos + 4 > end) break;
                    const handle = i32[pos >> 2]; pos += 4;
                    if (pos % 8 !== 0) pos += (8 - (pos % 8));
                    if (pos + 8 > end) break;
                    const alpha = f64[pos >> 3]; pos += 8;
                    const ctx = contexts[handle]; if(ctx) ctx.globalAlpha = alpha;
                    break;
                }

                case 63: {
                    if (pos + 4 > end) break;
                    const handle = i32[pos >> 2]; pos += 4;
                    if (pos + 4 > end) break;
                    const cap_len = i32[pos >> 2]; pos += 4;
                    const cap_pad = (cap_len + 3) & ~3;
                    if (pos + cap_pad > end) break;
                    const cap = decoder.decode(u8.subarray(pos, pos + cap_len)); pos += cap_pad;
                    const ctx = contexts[handle]; if(ctx) ctx.lineCap = cap;
                    break;
                }

                case 64: {
                    if (pos + 4 > end) break;
                    const handle = i32[pos >> 2]; pos += 4;
                    if (pos + 4 > end) break;
                    const join_len = i32[pos >> 2]; pos += 4;
                    const join_pad = (join_len + 3) & ~3;
                    if (pos + join_pad > end) break;
                    const join = decoder.decode(u8.subarray(pos, pos + join_len)); pos += join_pad;
                    const ctx = contexts[handle]; if(ctx) ctx.lineJoin = join;
                    break;
                }

                case 65: {
                    if (pos + 4 > end) break;
                    const handle = i32[pos >> 2]; pos += 4;
                    if (pos % 8 !== 0) pos += (8 - (pos % 8));
                    if (pos + 8 > end) break;
                    const blur = f64[pos >> 3]; pos += 8;
                    if (pos % 8 !== 0) pos += (8 - (pos % 8));
                    if (pos + 8 > end) break;
                    const off_x = f64[pos >> 3]; pos += 8;
                    if (pos % 8 !== 0) pos += (8 - (pos % 8));
                    if (pos + 8 > end) break;
                    const off_y = f64[pos >> 3]; pos += 8;
                    if (pos + 4 > end) break;
                    const color_len = i32[pos >> 2]; pos += 4;
                    const color_pad = (color_len + 3) & ~3;
                    if (pos + color_pad > end) break;
                    const color = decoder.decode(u8.subarray(pos, pos + color_len)); pos += color_pad;
                    const ctx = contexts[handle]; if(ctx) { ctx.shadowBlur = blur; ctx.shadowOffsetX = off_x; ctx.shadowOffsetY = off_y; ctx.shadowColor = color; }
                    break;
                }

                case 66: {
                    if (pos + 4 > end) break;
                    const handle = i32[pos >> 2]; pos += 4;
                    if (pos % 8 !== 0) pos += (8 - (pos % 8));
                    if (pos + 8 > end) break;
                    const cp1x = f64[pos >> 3]; pos += 8;
                    if (pos % 8 !== 0) pos += (8 - (pos % 8));
                    if (pos + 8 > end) break;
                    const cp1y = f64[pos >> 3]; pos += 8;
                    if (pos % 8 !== 0) pos += (8 - (pos % 8));
                    if (pos + 8 > end) break;
                    const cp2x = f64[pos >> 3]; pos += 8;
                    if (pos % 8 !== 0) pos += (8 - (pos % 8));
                    if (pos + 8 > end) break;
                    const cp2y = f64[pos >> 3]; pos += 8;
                    if (pos % 8 !== 0) pos += (8 - (pos % 8));
                    if (pos + 8 > end) break;
                    const x = f64[pos >> 3]; pos += 8;
                    if (pos % 8 !== 0) pos += (8 - (pos % 8));
                    if (pos + 8 > end) break;
                    const y = f64[pos >> 3]; pos += 8;
                    const ctx = contexts[handle]; if(ctx) ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, x, y);
                    break;
                }

                case 67: {
                    if (pos + 4 > end) break;
                    const handle = i32[pos >> 2]; pos += 4;
                    if (pos % 8 !== 0) pos += (8 - (pos % 8));
                    if (pos + 8 > end) break;
                    const cpx = f64[pos >> 3]; pos += 8;
                    if (pos % 8 !== 0) pos += (8 - (pos % 8));
                    if (pos + 8 > end) break;
                    const cpy = f64[pos >> 3]; pos += 8;
                    if (pos % 8 !== 0) pos += (8 - (pos % 8));
                    if (pos + 8 > end) break;
                    const x = f64[pos >> 3]; pos += 8;
                    if (pos % 8 !== 0) pos += (8 - (pos % 8));
                    if (pos + 8 > end) break;
                    const y = f64[pos >> 3]; pos += 8;
                    const ctx = contexts[handle]; if(ctx) ctx.quadraticCurveTo(cpx, cpy, x, y);
                    break;
                }

                case 68: {
                    if (pos + 4 > end) break;
                    const handle = i32[pos >> 2]; pos += 4;
                    if (pos % 8 !== 0) pos += (8 - (pos % 8));
                    if (pos + 8 > end) break;
                    const x = f64[pos >> 3]; pos += 8;
                    if (pos % 8 !== 0) pos += (8 - (pos % 8));
                    if (pos + 8 > end) break;
                    const y = f64[pos >> 3]; pos += 8;
                    if (pos % 8 !== 0) pos += (8 - (pos % 8));
                    if (pos + 8 > end) break;
                    const w = f64[pos >> 3]; pos += 8;
                    if (pos % 8 !== 0) pos += (8 - (pos % 8));
                    if (pos + 8 > end) break;
                    const h = f64[pos >> 3]; pos += 8;
                    const ctx = contexts[handle]; if(ctx) ctx.rect(x, y, w, h);
                    break;
                }

                case 69: {
                    if (pos + 4 > end) break;
                    const handle = i32[pos >> 2]; pos += 4;
                    const ctx = contexts[handle]; if(ctx) ctx.clip();
                    break;
                }

                case 70: {
                    if (pos + 4 > end) break;
                    const handle = i32[pos >> 2]; pos += 4;
                    if (pos + 4 > end) break;
                    const text_len = i32[pos >> 2]; pos += 4;
                    const text_pad = (text_len + 3) & ~3;
                    if (pos + text_pad > end) break;
                    const text = decoder.decode(u8.subarray(pos, pos + text_len)); pos += text_pad;
                    if (pos % 8 !== 0) pos += (8 - (pos % 8));
                    if (pos + 8 > end) break;
                    const x = f64[pos >> 3]; pos += 8;
                    if (pos % 8 !== 0) pos += (8 - (pos % 8));
                    if (pos + 8 > end) break;
                    const y = f64[pos >> 3]; pos += 8;
                    const ctx = contexts[handle]; if(ctx) ctx.strokeText(text, x, y);
                    break;
                }

                case 71: {
                    if (pos + 4 > end) break;
                    const handle = i32[pos >> 2]; pos += 4;
                    if (pos + 4 > end) break;
                    const baseline_len = i32[pos >> 2]; pos += 4;
                    const baseline_pad = (baseline_len + 3) & ~3;
                    if (pos + baseline_pad > end) break;
                    const baseline = decoder.decode(u8.subarray(pos, pos + baseline_len)); pos += baseline_pad;
                    const ctx = contexts[handle]; if(ctx) ctx.textBaseline = baseline;
                    break;
                }

                case 72: {
                    if (pos + 4 > end) break;
                    const handle = i32[pos >> 2]; pos += 4;
                    if (pos + 4 > end) break;
                    const op_len = i32[pos >> 2]; pos += 4;
                    const op_pad = (op_len + 3) & ~3;
                    if (pos + op_pad > end) break;
                    const op = decoder.decode(u8.subarray(pos, pos + op_len)); pos += op_pad;
                    const ctx = contexts[handle]; if(ctx) ctx.globalCompositeOperation = op;
                    break;
                }

                case 73: {
                    if (pos + 4 > end) break;
                    const handle = i32[pos >> 2]; pos += 4;
                    if (pos + 4 > end) break;
                    const img_handle = i32[pos >> 2]; pos += 4;
                    if (pos % 8 !== 0) pos += (8 - (pos % 8));
                    if (pos + 8 > end) break;
                    const x = f64[pos >> 3]; pos += 8;
                    if (pos % 8 !== 0) pos += (8 - (pos % 8));
                    if (pos + 8 > end) break;
                    const y = f64[pos >> 3]; pos += 8;
                    if (pos % 8 !== 0) pos += (8 - (pos % 8));
                    if (pos + 8 > end) break;
                    const w = f64[pos >> 3]; pos += 8;
                    if (pos % 8 !== 0) pos += (8 - (pos % 8));
                    if (pos + 8 > end) break;
                    const h = f64[pos >> 3]; pos += 8;
                    const ctx = contexts[handle]; const img = images[img_handle]; if(ctx && img) ctx.drawImage(img, x, y, w, h);
                    break;
                }

                case 74: {
                    if (pos + 4 > end) break;
                    const handle = i32[pos >> 2]; pos += 4;
                    if (pos + 4 > end) break;
                    const img_handle = i32[pos >> 2]; pos += 4;
                    if (pos % 8 !== 0) pos += (8 - (pos % 8));
                    if (pos + 8 > end) break;
                    const sx = f64[pos >> 3]; pos += 8;
                    if (pos % 8 !== 0) pos += (8 - (pos % 8));
                    if (pos + 8 > end) break;
                    const sy = f64[pos >> 3]; pos += 8;
                    if (pos % 8 !== 0) pos += (8 - (pos % 8));
                    if (pos + 8 > end) break;
                    const sw = f64[pos >> 3]; pos += 8;
                    if (pos % 8 !== 0) pos += (8 - (pos % 8));
                    if (pos + 8 > end) break;
                    const sh = f64[pos >> 3]; pos += 8;
                    if (pos % 8 !== 0) pos += (8 - (pos % 8));
                    if (pos + 8 > end) break;
                    const dx = f64[pos >> 3]; pos += 8;
                    if (pos % 8 !== 0) pos += (8 - (pos % 8));
                    if (pos + 8 > end) break;
                    const dy = f64[pos >> 3]; pos += 8;
                    if (pos % 8 !== 0) pos += (8 - (pos % 8));
                    if (pos + 8 > end) break;
                    const dw = f64[pos >> 3]; pos += 8;
                    if (pos % 8 !== 0) pos += (8 - (pos % 8));
                    if (pos + 8 > end) break;
                    const dh = f64[pos >> 3]; pos += 8;
                    const ctx = contexts[handle]; const img = images[img_handle]; if(ctx && img) ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
                    break;
                }

                case 75: {
                    if (pos + 4 > end) break;
                    const handle = i32[pos >> 2]; pos += 4;
                    const ctx = contexts[handle]; if(ctx) ctx.resetTransform();
                    break;
                }

                case 76: {
                    if (pos + 4 > end) break;
                    const handle = i32[pos >> 2]; pos += 4;
                    if (pos % 8 !== 0) pos += (8 - (pos % 8));
                    if (pos + 8 > end) break;
                    const x = f64[pos >> 3]; pos += 8;
                    if (pos % 8 !== 0) pos += (8 - (pos % 8));
                    if (pos + 8 > end) break;
                    const y = f64[pos >> 3]; pos += 8;
                    if (pos % 8 !== 0) pos += (8 - (pos % 8));
                    if (pos + 8 > end) break;
                    const radius_x = f64[pos >> 3]; pos += 8;
                    if (pos % 8 !== 0) pos += (8 - (pos % 8));
                    if (pos + 8 > end) break;
                    const radius_y = f64[pos >> 3]; pos += 8;
                    if (pos % 8 !== 0) pos += (8 - (pos % 8));
                    if (pos + 8 > end) break;
                    const rotation = f64[pos >> 3]; pos += 8;
                    if (pos % 8 !== 0) pos += (8 - (pos % 8));
                    if (pos + 8 > end) break;
                    const start_angle = f64[pos >> 3]; pos += 8;
                    if (pos % 8 !== 0) pos += (8 - (pos % 8));
                    if (pos + 8 > end) break;
                    const end_angle = f64[pos >> 3]; pos += 8;
                    if (pos + 4 > end) break;
                    const counter_clockwise = i32[pos >> 2]; pos += 4;
                    const ctx = contexts[handle]; if(ctx) ctx.ellipse(x, y, radius_x, radius_y, rotation, start_angle, end_angle, counter_clockwise !== 0);
                    break;
                }

                case 77: {
                    if (pos + 4 > end) break;
                    const handle = i32[pos >> 2]; pos += 4;
                    if (pos % 8 !== 0) pos += (8 - (pos % 8));
                    if (pos + 8 > end) break;
                    const x1 = f64[pos >> 3]; pos += 8;
                    if (pos % 8 !== 0) pos += (8 - (pos % 8));
                    if (pos + 8 > end) break;
                    const y1 = f64[pos >> 3]; pos += 8;
                    if (pos % 8 !== 0) pos += (8 - (pos % 8));
                    if (pos + 8 > end) break;
                    const x2 = f64[pos >> 3]; pos += 8;
                    if (pos % 8 !== 0) pos += (8 - (pos % 8));
                    if (pos + 8 > end) break;
                    const y2 = f64[pos >> 3]; pos += 8;
                    if (pos % 8 !== 0) pos += (8 - (pos % 8));
                    if (pos + 8 > end) break;
                    const radius = f64[pos >> 3]; pos += 8;
                    const ctx = contexts[handle]; if(ctx) ctx.arcTo(x1, y1, x2, y2, radius);
                    break;
                }

                case 78: {
                    if (pos + 4 > end) break;
                    const handle = i32[pos >> 2]; pos += 4;
                    if (pos % 8 !== 0) pos += (8 - (pos % 8));
                    if (pos + 8 > end) break;
                    const a = f64[pos >> 3]; pos += 8;
                    if (pos % 8 !== 0) pos += (8 - (pos % 8));
                    if (pos + 8 > end) break;
                    const b = f64[pos >> 3]; pos += 8;
                    if (pos % 8 !== 0) pos += (8 - (pos % 8));
                    if (pos + 8 > end) break;
                    const c = f64[pos >> 3]; pos += 8;
                    if (pos % 8 !== 0) pos += (8 - (pos % 8));
                    if (pos + 8 > end) break;
                    const d = f64[pos >> 3]; pos += 8;
                    if (pos % 8 !== 0) pos += (8 - (pos % 8));
                    if (pos + 8 > end) break;
                    const e = f64[pos >> 3]; pos += 8;
                    if (pos % 8 !== 0) pos += (8 - (pos % 8));
                    if (pos + 8 > end) break;
                    const f = f64[pos >> 3]; pos += 8;
                    const ctx = contexts[handle]; if(ctx) ctx.setTransform(a, b, c, d, e, f);
                    break;
                }

                case 79: {
                    if (pos + 4 > end) break;
                    const handle = i32[pos >> 2]; pos += 4;
                    if (pos % 8 !== 0) pos += (8 - (pos % 8));
                    if (pos + 8 > end) break;
                    const a = f64[pos >> 3]; pos += 8;
                    if (pos % 8 !== 0) pos += (8 - (pos % 8));
                    if (pos + 8 > end) break;
                    const b = f64[pos >> 3]; pos += 8;
                    if (pos % 8 !== 0) pos += (8 - (pos % 8));
                    if (pos + 8 > end) break;
                    const c = f64[pos >> 3]; pos += 8;
                    if (pos % 8 !== 0) pos += (8 - (pos % 8));
                    if (pos + 8 > end) break;
                    const d = f64[pos >> 3]; pos += 8;
                    if (pos % 8 !== 0) pos += (8 - (pos % 8));
                    if (pos + 8 > end) break;
                    const e = f64[pos >> 3]; pos += 8;
                    if (pos % 8 !== 0) pos += (8 - (pos % 8));
                    if (pos + 8 > end) break;
                    const f = f64[pos >> 3]; pos += 8;
                    const ctx = contexts[handle]; if(ctx) ctx.transform(a, b, c, d, e, f);
                    break;
                }

                case 80: {
                    if (pos + 4 > end) break;
                    const handle = i32[pos >> 2]; pos += 4;
                    if (pos % 8 !== 0) pos += (8 - (pos % 8));
                    if (pos + 8 > end) break;
                    const limit = f64[pos >> 3]; pos += 8;
                    const ctx = contexts[handle]; if(ctx) ctx.miterLimit = limit;
                    break;
                }

                case 81: {
                    if (pos + 4 > end) break;
                    const handle = i32[pos >> 2]; pos += 4;
                    if (pos + 4 > end) break;
                    const enabled = i32[pos >> 2]; pos += 4;
                    const ctx = contexts[handle]; if(ctx) ctx.imageSmoothingEnabled = (enabled !== 0);
                    break;
                }

                case 83: {
                    window.addEventListener('keydown', e => { push_event_input_KEY_DOWN(e.keyCode); _triggerDiscreteUpdate(); }); window.addEventListener('keyup', e => { push_event_input_KEY_UP(e.keyCode); _triggerDiscreteUpdate(); });
                    break;
                }

                case 84: {
                    if (pos + 4 > end) break;
                    const handle = i32[pos >> 2]; pos += 4;
                    const el = elements[handle] || document; el.addEventListener('mousedown', e => { push_event_input_MOUSE_DOWN(e.button, e.offsetX, e.offsetY); _triggerDiscreteUpdate(); }); el.addEventListener('mouseup', e => { push_event_input_MOUSE_UP(e.button, e.offsetX, e.offsetY); _triggerDiscreteUpdate(); }); el.addEventListener('mousemove', e => push_event_input_MOUSE_MOVE(e.offsetX, e.offsetY));
                    break;
                }

                case 85: {
                    document.exitPointerLock();
                    break;
                }

                case 86: {
                    if (pos + 4 > end) break;
                    const msg_len = i32[pos >> 2]; pos += 4;
                    const msg_pad = (msg_len + 3) & ~3;
                    if (pos + msg_pad > end) break;
                    const msg = decoder.decode(u8.subarray(pos, pos + msg_len)); pos += msg_pad;
                    console.log(msg);
                    break;
                }

                case 87: {
                    if (pos + 4 > end) break;
                    const msg_len = i32[pos >> 2]; pos += 4;
                    const msg_pad = (msg_len + 3) & ~3;
                    if (pos + msg_pad > end) break;
                    const msg = decoder.decode(u8.subarray(pos, pos + msg_len)); pos += msg_pad;
                    console.warn(msg);
                    break;
                }

                case 88: {
                    if (pos + 4 > end) break;
                    const msg_len = i32[pos >> 2]; pos += 4;
                    const msg_pad = (msg_len + 3) & ~3;
                    if (pos + msg_pad > end) break;
                    const msg = decoder.decode(u8.subarray(pos, pos + msg_len)); pos += msg_pad;
                    console.error(msg);
                    break;
                }

                case 89: {
                    if (pos + 4 > end) break;
                    const funcIdx = i32[pos >> 2]; pos += 4;
                    if (!table) { console.error('[bindweb] set_main_loop: function table not available'); break; }
                    const fn = table.get(funcIdx); if(!fn){ console.error('set_main_loop: function not found in table', funcIdx); break; }
                    _updateFn = fn; const loop = (t) => { fn(t); requestAnimationFrame(loop); }; requestAnimationFrame(loop);
                    break;
                }

                case 90: {
                    if (pos + 4 > end) break;
                    const title_len = i32[pos >> 2]; pos += 4;
                    const title_pad = (title_len + 3) & ~3;
                    if (pos + title_pad > end) break;
                    const title = decoder.decode(u8.subarray(pos, pos + title_len)); pos += title_pad;
                    document.title = title;
                    break;
                }

                case 91: {
                    location.reload();
                    break;
                }

                case 92: {
                    if (pos + 4 > end) break;
                    const url_len = i32[pos >> 2]; pos += 4;
                    const url_pad = (url_len + 3) & ~3;
                    if (pos + url_pad > end) break;
                    const url = decoder.decode(u8.subarray(pos, pos + url_len)); pos += url_pad;
                    window.open(url, '_blank');
                    break;
                }

                case 100: {
                    if (pos + 4 > end) break;
                    const path_len = i32[pos >> 2]; pos += 4;
                    const path_pad = (path_len + 3) & ~3;
                    if (pos + path_pad > end) break;
                    const path = decoder.decode(u8.subarray(pos, pos + path_len)); pos += path_pad;
                    history.pushState(null, '', path);
                    break;
                }

                case 101: {
                    window.addEventListener('popstate', () => push_event_system_POPSTATE(window.location.pathname || '/'));
                    break;
                }

                case 102: {
                    document.addEventListener('visibilitychange', () => push_event_system_VISIBILITY_CHANGE(document.hidden ? 1 : 0, document.visibilityState || 'visible'));
                    break;
                }

                case 103: {
                    if (pos + 4 > end) break;
                    const key_len = i32[pos >> 2]; pos += 4;
                    const key_pad = (key_len + 3) & ~3;
                    if (pos + key_pad > end) break;
                    const key = decoder.decode(u8.subarray(pos, pos + key_len)); pos += key_pad;
                    if (pos + 4 > end) break;
                    const value_len = i32[pos >> 2]; pos += 4;
                    const value_pad = (value_len + 3) & ~3;
                    if (pos + value_pad > end) break;
                    const value = decoder.decode(u8.subarray(pos, pos + value_len)); pos += value_pad;
                    localStorage.setItem(key, value);
                    break;
                }

                case 104: {
                    if (pos + 4 > end) break;
                    const key_len = i32[pos >> 2]; pos += 4;
                    const key_pad = (key_len + 3) & ~3;
                    if (pos + key_pad > end) break;
                    const key = decoder.decode(u8.subarray(pos, pos + key_len)); pos += key_pad;
                    localStorage.removeItem(key);
                    break;
                }

                case 105: {
                    localStorage.clear();
                    break;
                }

                case 107: {
                    if (pos + 4 > end) break;
                    const handle = i32[pos >> 2]; pos += 4;
                    const a = audios[handle]; if(a) a.play().catch(e => console.warn(e));
                    break;
                }

                case 108: {
                    if (pos + 4 > end) break;
                    const handle = i32[pos >> 2]; pos += 4;
                    const a = audios[handle]; if(a) a.pause();
                    break;
                }

                case 109: {
                    if (pos + 4 > end) break;
                    const handle = i32[pos >> 2]; pos += 4;
                    if (pos % 8 !== 0) pos += (8 - (pos % 8));
                    if (pos + 8 > end) break;
                    const vol = f64[pos >> 3]; pos += 8;
                    const a = audios[handle]; if(a) a.volume = vol;
                    break;
                }

                case 110: {
                    if (pos + 4 > end) break;
                    const handle = i32[pos >> 2]; pos += 4;
                    if (pos + 4 > end) break;
                    const loop = i32[pos >> 2]; pos += 4;
                    const a = audios[handle]; if(a) a.loop = (loop !== 0);
                    break;
                }

                case 114: {
                    if (pos + 4 > end) break;
                    const handle = i32[pos >> 2]; pos += 4;
                    if (pos + 4 > end) break;
                    const msg_len = i32[pos >> 2]; pos += 4;
                    const msg_pad = (msg_len + 3) & ~3;
                    if (pos + msg_pad > end) break;
                    const msg = decoder.decode(u8.subarray(pos, pos + msg_len)); pos += msg_pad;
                    const ws = websockets[handle]; if(ws && ws.readyState === 1) ws.send(msg);
                    break;
                }

                case 115: {
                    if (pos + 4 > end) break;
                    const handle = i32[pos >> 2]; pos += 4;
                    const ws = websockets[handle]; if(ws) { ws.close(); websockets[handle] = undefined; }
                    break;
                }

                case 120: {
                    if (pos + 4 > end) break;
                    const ctx_handle = i32[pos >> 2]; pos += 4;
                    if (pos + 4 > end) break;
                    const x = i32[pos >> 2]; pos += 4;
                    if (pos + 4 > end) break;
                    const y = i32[pos >> 2]; pos += 4;
                    if (pos + 4 > end) break;
                    const width = i32[pos >> 2]; pos += 4;
                    if (pos + 4 > end) break;
                    const height = i32[pos >> 2]; pos += 4;
                    const gl = contexts[ctx_handle]; if(gl) gl.viewport(x, y, width, height);
                    break;
                }

                case 121: {
                    if (pos + 4 > end) break;
                    const ctx_handle = i32[pos >> 2]; pos += 4;
                    if (pos % 8 !== 0) pos += (8 - (pos % 8));
                    if (pos + 8 > end) break;
                    const r = f64[pos >> 3]; pos += 8;
                    if (pos % 8 !== 0) pos += (8 - (pos % 8));
                    if (pos + 8 > end) break;
                    const g = f64[pos >> 3]; pos += 8;
                    if (pos % 8 !== 0) pos += (8 - (pos % 8));
                    if (pos + 8 > end) break;
                    const b = f64[pos >> 3]; pos += 8;
                    if (pos % 8 !== 0) pos += (8 - (pos % 8));
                    if (pos + 8 > end) break;
                    const a = f64[pos >> 3]; pos += 8;
                    const gl = contexts[ctx_handle]; if(gl) gl.clearColor(r, g, b, a);
                    break;
                }

                case 122: {
                    if (pos + 4 > end) break;
                    const ctx_handle = i32[pos >> 2]; pos += 4;
                    if (pos + 4 > end) break;
                    const mask = i32[pos >> 2]; pos += 4;
                    const gl = contexts[ctx_handle]; if(gl) gl.clear(mask);
                    break;
                }

                case 125: {
                    if (pos + 4 > end) break;
                    const ctx_handle = i32[pos >> 2]; pos += 4;
                    if (pos + 4 > end) break;
                    const prog_handle = i32[pos >> 2]; pos += 4;
                    if (pos + 4 > end) break;
                    const shader_handle = i32[pos >> 2]; pos += 4;
                    const gl = contexts[ctx_handle]; const p = webgl_programs[prog_handle]; const s = webgl_shaders[shader_handle]; if(gl && p && s) gl.attachShader(p, s);
                    break;
                }

                case 126: {
                    if (pos + 4 > end) break;
                    const ctx_handle = i32[pos >> 2]; pos += 4;
                    if (pos + 4 > end) break;
                    const prog_handle = i32[pos >> 2]; pos += 4;
                    const gl = contexts[ctx_handle]; const p = webgl_programs[prog_handle]; if(gl && p) { gl.linkProgram(p); if(!gl.getProgramParameter(p, gl.LINK_STATUS)) console.error(gl.getProgramInfoLog(p)); }
                    break;
                }

                case 127: {
                    if (pos + 4 > end) break;
                    const ctx_handle = i32[pos >> 2]; pos += 4;
                    if (pos + 4 > end) break;
                    const prog_handle = i32[pos >> 2]; pos += 4;
                    if (pos + 4 > end) break;
                    const index = i32[pos >> 2]; pos += 4;
                    if (pos + 4 > end) break;
                    const name_len = i32[pos >> 2]; pos += 4;
                    const name_pad = (name_len + 3) & ~3;
                    if (pos + name_pad > end) break;
                    const name = decoder.decode(u8.subarray(pos, pos + name_len)); pos += name_pad;
                    const gl = contexts[ctx_handle]; const p = webgl_programs[prog_handle]; if(gl && p) gl.bindAttribLocation(p, index, name);
                    break;
                }

                case 128: {
                    if (pos + 4 > end) break;
                    const ctx_handle = i32[pos >> 2]; pos += 4;
                    if (pos + 4 > end) break;
                    const prog_handle = i32[pos >> 2]; pos += 4;
                    const gl = contexts[ctx_handle]; const p = webgl_programs[prog_handle]; if(gl && p) gl.useProgram(p);
                    break;
                }

                case 130: {
                    if (pos + 4 > end) break;
                    const ctx_handle = i32[pos >> 2]; pos += 4;
                    if (pos + 4 > end) break;
                    const target = i32[pos >> 2]; pos += 4;
                    if (pos + 4 > end) break;
                    const buf_handle = i32[pos >> 2]; pos += 4;
                    const gl = contexts[ctx_handle]; const b = webgl_buffers[buf_handle]; if(gl && b) gl.bindBuffer(target, b);
                    break;
                }

                case 131: {
                    if (pos + 4 > end) break;
                    const ctx_handle = i32[pos >> 2]; pos += 4;
                    if (pos + 4 > end) break;
                    const target = i32[pos >> 2]; pos += 4;
                    if (pos + 4 > end) break;
                    const data_ptr = i32[pos >> 2]; pos += 4;
                    if (pos + 4 > end) break;
                    const data_len = i32[pos >> 2]; pos += 4;
                    if (pos + 4 > end) break;
                    const usage = i32[pos >> 2]; pos += 4;
                    const gl = contexts[ctx_handle]; if(gl) { const data = new Uint8Array(memory.buffer, data_ptr, data_len); gl.bufferData(target, data, usage); }
                    break;
                }

                case 132: {
                    if (pos + 4 > end) break;
                    const ctx_handle = i32[pos >> 2]; pos += 4;
                    if (pos + 4 > end) break;
                    const index = i32[pos >> 2]; pos += 4;
                    const gl = contexts[ctx_handle]; if(gl) gl.enableVertexAttribArray(index);
                    break;
                }

                case 133: {
                    if (pos + 4 > end) break;
                    const ctx_handle = i32[pos >> 2]; pos += 4;
                    if (pos + 4 > end) break;
                    const cap = i32[pos >> 2]; pos += 4;
                    const gl = contexts[ctx_handle]; if(gl) gl.enable(cap);
                    break;
                }

                case 135: {
                    if (pos + 4 > end) break;
                    const ctx_handle = i32[pos >> 2]; pos += 4;
                    if (pos + 4 > end) break;
                    const loc_handle = i32[pos >> 2]; pos += 4;
                    if (pos % 8 !== 0) pos += (8 - (pos % 8));
                    if (pos + 8 > end) break;
                    const val = f64[pos >> 3]; pos += 8;
                    const gl = contexts[ctx_handle]; const loc = webgl_uniforms[loc_handle]; if(loc === undefined) console.warn('uniform_1f: loc undefined', loc_handle); if(gl && loc !== undefined) gl.uniform1f(loc, val);
                    break;
                }

                case 136: {
                    if (pos + 4 > end) break;
                    const ctx_handle = i32[pos >> 2]; pos += 4;
                    if (pos + 4 > end) break;
                    const index = i32[pos >> 2]; pos += 4;
                    if (pos + 4 > end) break;
                    const size = i32[pos >> 2]; pos += 4;
                    if (pos + 4 > end) break;
                    const type = i32[pos >> 2]; pos += 4;
                    if (pos + 4 > end) break;
                    const normalized = i32[pos >> 2]; pos += 4;
                    if (pos + 4 > end) break;
                    const stride = i32[pos >> 2]; pos += 4;
                    if (pos + 4 > end) break;
                    const offset = i32[pos >> 2]; pos += 4;
                    const gl = contexts[ctx_handle]; if(gl) gl.vertexAttribPointer(index, size, type, normalized !== 0, stride, offset);
                    break;
                }

                case 137: {
                    if (pos + 4 > end) break;
                    const ctx_handle = i32[pos >> 2]; pos += 4;
                    if (pos + 4 > end) break;
                    const mode = i32[pos >> 2]; pos += 4;
                    if (pos + 4 > end) break;
                    const first = i32[pos >> 2]; pos += 4;
                    if (pos + 4 > end) break;
                    const count = i32[pos >> 2]; pos += 4;
                    const gl = contexts[ctx_handle]; if(gl) gl.drawArrays(mode, first, count);
                    break;
                }

                case 138: {
                    if (!navigator.gpu) { console.warn('NO: navigator.gpu is undefined — WebGPU not available'); push_event_wgpu_ADAPTER_READY(-1); return; } console.log('navigator.gpu OK'); navigator.gpu.requestAdapter({ powerPreference: 'high-performance' }).then(a => a || navigator.gpu.requestAdapter()).then(adapter => { if (!adapter) { console.warn('NO: requestAdapter returned null — no usable adapter'); push_event_wgpu_ADAPTER_READY(-1); return; } console.log('Adapter:', adapter); console.log('Features:', Array.from(adapter.features || [])); console.log('Limits:', adapter.limits || {}); const h = (nextHandle++); webgpu_adapters[h] = adapter; push_event_wgpu_ADAPTER_READY(h); }).catch(e => { console.error('requestAdapter failed:', e); push_event_wgpu_ADAPTER_READY(-1); });
                    break;
                }

                case 139: {
                    if (pos + 4 > end) break;
                    const adapter_handle = i32[pos >> 2]; pos += 4;
                    const a = webgpu_adapters[adapter_handle]; if(a) a.requestDevice().then(d => { const h = (nextHandle++); webgpu_devices[h] = d; webgpu_queues[h] = d.queue; push_event_wgpu_DEVICE_READY(h); }).catch(e => console.error("WebGPU: requestDevice failed", e));
                    break;
                }

                case 143: {
                    if (pos + 4 > end) break;
                    const context_handle = i32[pos >> 2]; pos += 4;
                    if (pos + 4 > end) break;
                    const device_handle = i32[pos >> 2]; pos += 4;
                    if (pos + 4 > end) break;
                    const format_len = i32[pos >> 2]; pos += 4;
                    const format_pad = (format_len + 3) & ~3;
                    if (pos + format_pad > end) break;
                    const format = decoder.decode(u8.subarray(pos, pos + format_len)); pos += format_pad;
                    const ctx = contexts[context_handle]; const dev = webgpu_devices[device_handle]; if(ctx && dev) ctx.configure({ device: dev, format: format === 'preferred' ? navigator.gpu.getPreferredCanvasFormat() : format, alphaMode: 'premultiplied' });
                    break;
                }

                case 146: {
                    if (pos + 4 > end) break;
                    const pass_handle = i32[pos >> 2]; pos += 4;
                    const pass = webgpu_passes[pass_handle]; if(pass) pass.end();
                    break;
                }

                case 148: {
                    if (pos + 4 > end) break;
                    const queue_handle = i32[pos >> 2]; pos += 4;
                    if (pos + 4 > end) break;
                    const command_buffer_handle = i32[pos >> 2]; pos += 4;
                    const q = webgpu_queues[queue_handle]; const cb = webgpu_buffers[command_buffer_handle]; if(q && cb) q.submit([cb]);
                    break;
                }

                case 150: {
                    if (pos + 4 > end) break;
                    const pass_handle = i32[pos >> 2]; pos += 4;
                    if (pos + 4 > end) break;
                    const pipeline_handle = i32[pos >> 2]; pos += 4;
                    const pass = webgpu_passes[pass_handle]; const pipe = webgpu_pipelines[pipeline_handle]; if(pass && pipe) pass.setPipeline(pipe);
                    break;
                }

                case 151: {
                    if (pos + 4 > end) break;
                    const pass_handle = i32[pos >> 2]; pos += 4;
                    if (pos + 4 > end) break;
                    const vertex_count = i32[pos >> 2]; pos += 4;
                    if (pos + 4 > end) break;
                    const instance_count = i32[pos >> 2]; pos += 4;
                    if (pos + 4 > end) break;
                    const first_vertex = i32[pos >> 2]; pos += 4;
                    if (pos + 4 > end) break;
                    const first_instance = i32[pos >> 2]; pos += 4;
                    const pass = webgpu_passes[pass_handle]; if(pass) pass.draw(vertex_count, instance_count, first_vertex, first_instance);
                    break;
                }

                case 152: {
                    if (pos + 4 > end) break;
                    const handle = i32[pos >> 2]; pos += 4;
                    const el = elements[handle] || document; el.addEventListener('wheel', e => { push_event_input_MOUSE_WHEEL(e.deltaX|0, e.deltaY|0); _triggerDiscreteUpdate(); }, { passive: true });
                    break;
                }

                case 153: {
                    window.addEventListener('resize', () => { push_event_input_RESIZE(window.innerWidth|0, window.innerHeight|0); _triggerDiscreteUpdate(); }); push_event_input_RESIZE(window.innerWidth|0, window.innerHeight|0);
                    break;
                }

                case 30: {  // RELEASE_HANDLE
                    if (pos + 4 > end) break;
                    const handle = i32[pos >> 2]; pos += 4;
                    releaseHandle(handle);
                    break;
                }

                case 31: {  // INJECT_SCRIPT
                    if (pos + 4 > end) break;
                    const code_len = i32[pos >> 2]; pos += 4;
                    const code_pad = (code_len + 3) & ~3;
                    if (pos + code_pad > end) break;
                    const code = decoder.decode(u8.subarray(pos, pos + code_len)); pos += code_pad;
                    const s = document.createElement('script');
                    s.textContent = code;
                    document.head.appendChild(s);
                    break;
                }

                default: console.error("[bindweb] Unknown opcode:", opcode); return;
            }
        }
    }

    // -- Public API --
    return {
        imports: { env: envImports },
        connect(instance) {
            exports = instance.exports; memory = exports.memory;
            table = exports.__indirect_function_table || (typeof WebAssembly !== 'undefined' && WebAssembly.Table ? instance.exports['__indirect_function_table'] : null);
            if (!table) console.warn('[bindweb] __indirect_function_table not found — setMainLoop will not work');
            event_buffer_ptr_val = exports.bindweb_event_buffer_ptr();
            event_offset_ptr_val = exports.bindweb_event_offset_ptr();
            scratch_buffer_ptr_val = exports.bindweb_scratch_buffer_ptr();
            EVENT_BUFFER_SIZE = exports.bindweb_event_buffer_capacity();
            refreshViews(); connected = true;
            if (!_eventAttached) {
                document.body.addEventListener('click', (e) => { let el = e.target, p = false; while (el && el !== document.body) { if (el.dataset.c) { push_event_dom_CLICK(parseInt(el.dataset.c)); p = true; } el = el.parentElement; } if (p) _triggerUpdate(); });
                document.body.addEventListener('input', (e) => { let el = e.target, p = false; while (el && el !== document.body) { if (el.dataset.i) { push_event_dom_INPUT(parseInt(el.dataset.i), e.target.value || ''); p = true; } el = el.parentElement; } if (p) _triggerUpdate(); });
                document.body.addEventListener('change', (e) => { let el = e.target, p = false; while (el && el !== document.body) { if (el.dataset.g) { const v = e.target.type === 'checkbox' ? (e.target.checked ? 'true' : 'false') : (e.target.value || ''); push_event_dom_CHANGE(parseInt(el.dataset.g), v); p = true; } el = el.parentElement; } if (p) _triggerUpdate(); });
                _eventAttached = true;
            }
            return this;
        },
        startEventLoop() {
            // RESIZE is only available when the schema defines it (the generator
            // emits push_event_input_RESIZE in that case). `typeof` on a possibly-
            // undeclared identifier is safe and won't throw, so this guard avoids the
            // ReferenceError when the current schema has no RESIZE event.
            if (typeof push_event_input_RESIZE === 'function') {
                window.addEventListener('resize', () => { push_event_input_RESIZE(window.innerWidth, window.innerHeight); _triggerUpdate(); });
                push_event_input_RESIZE(window.innerWidth, window.innerHeight);
            }
        },
        disconnect() { connected = false; memory = null; exports = null; table = null; },
        get isConnected() { return connected; }
    };
}
export default createBindwebRunner;
