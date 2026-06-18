/* ============================================================================
 * Nim Bindweb Core Runtime - C Implementation
 * ============================================================================
 * Single-file C implementation of the Nim Bindweb WASM runtime.
 *
 * Subsystems:
 *   1. Command Buffer   - 1MB buffer for C-to-JS command encoding
 *   2. Event Buffer     - 1MB buffer for JS-to-C event delivery
 *   3. Scratch Buffer   - 4KB buffer for temporary JS-to-C data
 *   4. Flush            - Command buffer flush to JS via imported function
 *   5. Allocator        - Free-list allocator with bump allocation fallback
 *   6. Libc Stubs       - Minimal libc for -nostdlib builds
 *
 * All exported functions use __attribute__((used, visibility("default"))) so
 * they are preserved by the linker and visible to JavaScript.
 * ============================================================================ */

#include "bindweb_runtime.h"

/* ============================================================================
 * SECTION 1: Command Buffer
 * ============================================================================
 * A single static 1MB buffer used to accumulate commands sent from C to JS.
 * All integer values are written little-endian.  The buffer is reset after
 * each flush.
 *
 * Wire format:
 *   - uint32 / int32: 4 bytes little-endian
 *   - float32:        4 bytes (memcpy to uint32, then little-endian)
 *   - float64:        align to 8, then 8 bytes (2x little-endian uint32)
 *   - string:         4-byte len + string data + padding to 4-byte alignment
 * ============================================================================ */

/** g_cmd_buffer: static 1MB buffer, aligned to 8 bytes for double writes. */
static __attribute__((aligned(8))) uint8_t g_cmd_buffer[WEBCC_COMMAND_BUFFER_SIZE];

/** g_cmd_offset: current write position in the command buffer. */
static size_t g_cmd_offset = 0;

/* ------------------------------------------------------------------------ */

__attribute__((used, visibility("default")))
void bindweb_push_u32(uint32_t v) {
    if (g_cmd_offset + 4 <= WEBCC_COMMAND_BUFFER_SIZE) {
        g_cmd_buffer[g_cmd_offset++] = v & 0xFF;
        g_cmd_buffer[g_cmd_offset++] = (v >> 8) & 0xFF;
        g_cmd_buffer[g_cmd_offset++] = (v >> 16) & 0xFF;
        g_cmd_buffer[g_cmd_offset++] = (v >> 24) & 0xFF;
    }
}

__attribute__((used, visibility("default")))
void bindweb_push_i32(int32_t v) {
    bindweb_push_u32((uint32_t)v);
}

__attribute__((used, visibility("default")))
void bindweb_push_float(float v) {
    uint32_t u;
    memcpy(&u, &v, 4);
    bindweb_push_u32(u);
}

__attribute__((used, visibility("default")))
void bindweb_push_double(double v) {
    /* Align to 8 bytes before writing the 64-bit value. */
    if (g_cmd_offset % 8 != 0) {
        size_t pad = 8 - (g_cmd_offset % 8);
        for (size_t k = 0; k < pad; ++k) {
            if (g_cmd_offset < WEBCC_COMMAND_BUFFER_SIZE)
                g_cmd_buffer[g_cmd_offset++] = 0;
        }
    }

    uint64_t u;
    memcpy(&u, &v, 8);

    /* Push as two 32-bit values (little-endian). */
    bindweb_push_u32((uint32_t)(u & 0xFFFFFFFF));
    bindweb_push_u32((uint32_t)(u >> 32));
}

__attribute__((used, visibility("default")))
void bindweb_push_string(const char* str, size_t len) {
    bindweb_push_u32((uint32_t)len);

    if (str && g_cmd_offset + len <= WEBCC_COMMAND_BUFFER_SIZE) {
        for (size_t k = 0; k < len; ++k)
            g_cmd_buffer[g_cmd_offset++] = str[k];
    }

    /* Pad to 4-byte alignment. */
    size_t pad = (4 - (len % 4)) % 4;
    for (size_t k = 0; k < pad; ++k) {
        if (g_cmd_offset < WEBCC_COMMAND_BUFFER_SIZE)
            g_cmd_buffer[g_cmd_offset++] = 0;
    }
}

__attribute__((used, visibility("default")))
const uint8_t* bindweb_command_buffer_data(void) {
    return g_cmd_buffer;
}

__attribute__((used, visibility("default")))
size_t bindweb_command_buffer_size(void) {
    return g_cmd_offset;
}

__attribute__((used, visibility("default")))
void bindweb_command_buffer_reset(void) {
    g_cmd_offset = 0;
}

/* ============================================================================
 * SECTION 2: Event Buffer
 * ============================================================================
 * A single static 1MB buffer written by JavaScript and read by C.
 *
 * JS writes events in the following format:
 *   [Opcode:1][Pad:1][TotalSize:2][Data...]
 *
 *   - Opcode:    1 byte event type identifier
 *   - Pad:       1 byte padding (ignored)
 *   - TotalSize: 2 bytes little-endian, total size of the event in bytes
 *   - Data:      payload bytes (TotalSize - 4 bytes)
 *
 * The C side reads events sequentially via bindweb_next_event().  After all
 * events have been consumed the buffer is reset.
 * ============================================================================ */

/** g_event_buffer: static 1MB buffer, aligned to 8 bytes. */
static __attribute__((aligned(8))) uint8_t g_event_buffer[WEBCC_EVENT_BUFFER_SIZE];

/** g_event_offset: number of valid bytes written by JS. */
static uint32_t g_event_offset = 0;

/** g_event_read_offset: current read position used by next_event(). */
static uint32_t g_event_read_offset = 0;

/* ------------------------------------------------------------------------ */

__attribute__((used, visibility("default")))
uint8_t* bindweb_event_buffer_ptr(void) {
    return g_event_buffer;
}

__attribute__((used, visibility("default")))
uint32_t* bindweb_event_offset_ptr(void) {
    return &g_event_offset;
}

__attribute__((used, visibility("default")))
uint32_t bindweb_event_buffer_capacity(void) {
    return WEBCC_EVENT_BUFFER_SIZE;
}

__attribute__((used, visibility("default")))
void bindweb_reset_event_buffer(void) {
    g_event_offset = 0;
    g_event_read_offset = 0;
}

__attribute__((used, visibility("default")))
const uint8_t* bindweb_event_buffer_data(void) {
    return g_event_buffer;
}

__attribute__((used, visibility("default")))
uint32_t bindweb_event_buffer_size(void) {
    return g_event_offset;
}

__attribute__((used, visibility("default")))
bool bindweb_next_event(uint8_t* opcode, const uint8_t** data_ptr, uint32_t* data_len) {
    uint32_t size = g_event_offset;

    /* All events consumed?  Reset and return false. */
    if (g_event_read_offset >= size) {
        bindweb_reset_event_buffer();
        return false;
    }

    /* Need at least 4 bytes for the header. */
    if (g_event_read_offset + 4 > size) {
        bindweb_reset_event_buffer();
        return false;
    }

    /* Parse header: [Opcode:1][Pad:1][TotalSize:2] */
    *opcode = g_event_buffer[g_event_read_offset];

    uint16_t total_event_size =
        (uint16_t)g_event_buffer[g_event_read_offset + 2] |
        ((uint16_t)g_event_buffer[g_event_read_offset + 3] << 8);

    /* Sanity check: total size must not exceed buffer. */
    if (g_event_read_offset + total_event_size > size) {
        bindweb_reset_event_buffer();
        return false;
    }

    /* Data starts after the 4-byte header. */
    *data_ptr = g_event_buffer + g_event_read_offset + 4;
    *data_len = (uint32_t)total_event_size - 4;

    g_event_read_offset += total_event_size;
    return true;
}

/* ============================================================================
 * SECTION 3: Scratch Buffer
 * ============================================================================
 * A small (4KB) static buffer used for temporary JS-to-C data transfers.
 *
 * Use case: When C calls a JS function that returns a string (e.g.
 * get_attribute), JS cannot return the string directly because WASM only
 * supports numeric return values.  Instead:
 *   1. JS writes the string data into this scratch buffer.
 *   2. JS returns the length of the string.
 *   3. C immediately reads the data from the scratch buffer and copies it.
 *
 * This avoids dynamic memory allocation for transient return values.
 * WARNING: Data is ephemeral — valid only until the next JS call that uses
 * the scratch buffer.
 * ============================================================================ */

/** g_scratch_buffer: static 4KB buffer, aligned to 8 bytes. */
static __attribute__((aligned(8))) uint8_t g_scratch_buffer[WEBCC_SCRATCH_BUFFER_SIZE];

/* ------------------------------------------------------------------------ */

__attribute__((used, visibility("default")))
uint8_t* bindweb_scratch_buffer_ptr(void) {
    return g_scratch_buffer;
}

__attribute__((used, visibility("default")))
uint32_t bindweb_scratch_buffer_capacity(void) {
    return WEBCC_SCRATCH_BUFFER_SIZE;
}

__attribute__((used, visibility("default")))
const uint8_t* bindweb_scratch_buffer_data(void) {
    return g_scratch_buffer;
}

/* ============================================================================
 * SECTION 4: Flush
 * ============================================================================
 * Sends the accumulated command buffer to JavaScript and then resets it.
 * If the buffer is empty, nothing is sent.
 * ============================================================================ */

__attribute__((used, visibility("default")))
void bindweb_flush(void) {
    size_t s = bindweb_command_buffer_size();
    if (s == 0)
        return;
    bindweb_js_flush((uintptr_t)bindweb_command_buffer_data(), s);
    bindweb_command_buffer_reset();
}

/* ============================================================================
 * SECTION 5: Allocator
 * ============================================================================
 * A simple free-list allocator with bump-allocation fallback.
 *
 *   - Uses __heap_base (provided by the WASM linker) as the start of heap.
 *   - All allocations are 8-byte aligned.
 *   - Free blocks are kept in a singly-linked LIFO list.
 *   - When the free list cannot satisfy a request, memory is bumped from the
 *     heap.  If the heap exceeds current WASM memory, the memory is grown.
 *
 * This allocator ONLY serves the runtime.  Nim's GC handles its own memory.
 * ============================================================================ */

/** BlockHeader: metadata stored before each allocated block. */
typedef struct BlockHeader {
    size_t            size;   /**< User-visible size (without header). */
    struct BlockHeader* next; /**< Next block in the free list.        */
} BlockHeader;

/** __heap_base: linker-provided symbol marking the start of free RAM. */
extern uint8_t __heap_base;

/** g_heap_ptr: current bump pointer.  Initialised to &__heap_base. */
static uintptr_t g_heap_ptr = 0;

/** g_free_list: head of the free block list (LIFO). */
static BlockHeader* g_free_list = NULL;

/** g_allocator_ready: set to 1 once g_heap_ptr has been initialised. */
static int g_allocator_ready = 0;

/** Ensure the heap pointer has been initialised from __heap_base. */
static inline void allocator_ensure_init(void) {
    if (!g_allocator_ready) {
        g_heap_ptr = (uintptr_t)&__heap_base;
        g_allocator_ready = 1;
    }
}

/* ------------------------------------------------------------------------ */

__attribute__((used, visibility("default")))
void* bindweb_malloc(size_t size) {
    if (size == 0)
        return NULL;

    allocator_ensure_init();

    /* Align requested size to 8 bytes. */
    size = (size + 7) & ~(size_t)7;

    /* Total size including the BlockHeader. */
    size_t total_size = size + sizeof(BlockHeader);

    /* 1. Search the free list for a block large enough. */
    BlockHeader* prev = NULL;
    BlockHeader* curr = g_free_list;

    while (curr) {
        if (curr->size >= size) {
            /* Unlink from free list. */
            if (prev)
                prev->next = curr->next;
            else
                g_free_list = curr->next;

            /* Return pointer to the user-data area (past the header). */
            return (void*)((uint8_t*)curr + sizeof(BlockHeader));
        }
        prev = curr;
        curr = curr->next;
    }

    /* 2. No suitable free block — bump allocate from the heap. */
    uintptr_t current = g_heap_ptr;
    g_heap_ptr += total_size;

    /* Check whether we have exceeded current WASM memory. */
    size_t current_pages = __builtin_wasm_memory_size(0);
    uintptr_t max_mem = current_pages * 64 * 1024;

    if (g_heap_ptr > max_mem) {
        size_t bytes_needed = g_heap_ptr - max_mem;
        size_t pages_to_add = (bytes_needed + 65535) / 65536;

        if (__builtin_wasm_memory_grow(0, pages_to_add) == (size_t)-1) {
            /* Grow failed — roll back and return NULL. */
            g_heap_ptr = current;
            return NULL;
        }
    }

    BlockHeader* header = (BlockHeader*)current;
    header->size = size;
    header->next = NULL;

    return (void*)((uint8_t*)header + sizeof(BlockHeader));
}

__attribute__((used, visibility("default")))
void bindweb_free(void* ptr) {
    if (!ptr)
        return;

    /* Walk back to the BlockHeader. */
    BlockHeader* header = (BlockHeader*)((uint8_t*)ptr - sizeof(BlockHeader));

    /* Push onto the front of the free list (LIFO). */
    header->next = g_free_list;
    g_free_list = header;
}

/* ============================================================================
 * SECTION 6: Libc Stubs
 * ============================================================================
 * Minimal implementations of standard C library functions.
 *
 * Since we compile with -nostdlib, these symbols are not available by default.
 * Compilers may implicitly generate calls to them (e.g. for struct copying or
 * initialisation).  Providing them here makes the WASM module self-contained
 * and avoids link errors.
 * ============================================================================ */

__attribute__((used, visibility("default")))
size_t strlen(const char* s) {
    const char* p = s;
    while (*p)
        ++p;
    return (size_t)(p - s);
}

__attribute__((used, visibility("default")))
void* memcpy(void* dest, const void* src, size_t n) {
    uint8_t*       d = (uint8_t*)dest;
    const uint8_t* s = (const uint8_t*)src;
    while (n--)
        *d++ = *s++;
    return dest;
}

__attribute__((used, visibility("default")))
void* memset(void* dest, int c, size_t n) {
    uint8_t* d = (uint8_t*)dest;
    while (n--)
        *d++ = (uint8_t)c;
    return dest;
}

__attribute__((used, visibility("default")))
void* memmove(void* dest, const void* src, size_t n) {
    uint8_t*       d = (uint8_t*)dest;
    const uint8_t* s = (const uint8_t*)src;

    if (d < s) {
        /* Non-overlapping or forward copy. */
        while (n--)
            *d++ = *s++;
    } else {
        /* Overlapping — copy backwards. */
        d += n;
        s += n;
        while (n--)
            *--d = *--s;
    }
    return dest;
}

/* ----------------------------------------------------------------------------
 * WebAssembly entry shim
 * ----------------------------------------------------------------------------
 * wasi crt1.o's _start calls main(argc, argv) (2 args). Nim's C backend emits a
 * 3-arg main(argc, args, env) for posix targets, which mismatches crt1's call
 * signature and makes wasm-ld emit a trapping stub. Building Bindweb apps with
 * --noMain suppresses Nim's main; this 2-arg shim takes its place and runs the
 * Nim program by calling NimMain(). (Mirrors the Nim-WASM-Compiler "2-arg main"
 * fix, but done in C at build time instead of by rewriting generated C.)
 * -------------------------------------------------------------------------- */
#ifdef __wasm__
extern void NimMain(void);
/* asm("main") forces the link symbol to stay exactly "main": clang's wasm
 * driver otherwise renames a function literally named main to __main_argc_argv
 * (new wasi-libc convention), but this sysroot's crt1.o calls plain main. */
int bindweb_wasm_entry(int argc, char **argv) asm("main");
int bindweb_wasm_entry(int argc, char **argv) {
  (void)argc; (void)argv;
  NimMain();
  return 0;
}
#endif
