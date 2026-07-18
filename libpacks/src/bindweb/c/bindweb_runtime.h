/* ============================================================================
 * Nim Bindweb Core Runtime - C Header
 * ============================================================================
 * This is the C port of the Nim Bindweb core runtime. It manages the command buffer,
 * event buffer, scratch buffer, memory allocator, and minimal libc stubs.
 *
 * Compiled to WebAssembly with -nostdlib. All exported functions use the
 * bindweb_ prefix and are marked with visibility attributes for WASM linking.
 * ============================================================================ */

#ifndef BINDWEB_RUNTIME_H
#define BINDWEB_RUNTIME_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/* ----------------------------------------------------------------------------
 * Constants
 * ---------------------------------------------------------------------------- */

#ifndef WEBCC_COMMAND_BUFFER_SIZE
#define WEBCC_COMMAND_BUFFER_SIZE (1024 * 1024)
#endif
#ifndef WEBCC_EVENT_BUFFER_SIZE
#define WEBCC_EVENT_BUFFER_SIZE   (1024 * 1024)
#endif
#ifndef WEBCC_SCRATCH_BUFFER_SIZE
#define WEBCC_SCRATCH_BUFFER_SIZE 4096
#endif

/* ----------------------------------------------------------------------------
 * JS Import
 * ---------------------------------------------------------------------------- */

__attribute__((import_module("env"), import_name("bindweb_js_flush")))
extern void bindweb_js_flush(uintptr_t ptr, size_t size);

/* ----------------------------------------------------------------------------
 * Command Buffer
 * ---------------------------------------------------------------------------- */

__attribute__((used, visibility("default")))
void bindweb_push_u32(uint32_t v);

__attribute__((used, visibility("default")))
void bindweb_push_i32(int32_t v);

__attribute__((used, visibility("default")))
void bindweb_push_float(float v);

__attribute__((used, visibility("default")))
void bindweb_push_double(double v);

__attribute__((used, visibility("default")))
void bindweb_push_string(const char* str, size_t len);

__attribute__((used, visibility("default")))
const uint8_t* bindweb_command_buffer_data(void);

__attribute__((used, visibility("default")))
size_t bindweb_command_buffer_size(void);

__attribute__((used, visibility("default")))
void bindweb_command_buffer_reset(void);

/* ----------------------------------------------------------------------------
 * Event Buffer
 * ---------------------------------------------------------------------------- */

__attribute__((used, visibility("default")))
uint8_t* bindweb_event_buffer_ptr(void);

__attribute__((used, visibility("default")))
uint32_t* bindweb_event_offset_ptr(void);

__attribute__((used, visibility("default")))
uint32_t bindweb_event_buffer_capacity(void);

__attribute__((used, visibility("default")))
void bindweb_reset_event_buffer(void);

__attribute__((used, visibility("default")))
const uint8_t* bindweb_event_buffer_data(void);

__attribute__((used, visibility("default")))
uint32_t bindweb_event_buffer_size(void);

__attribute__((used, visibility("default")))
bool bindweb_next_event(uint8_t* opcode, const uint8_t** data_ptr, uint32_t* data_len);

/* ----------------------------------------------------------------------------
 * Scratch Buffer
 * ---------------------------------------------------------------------------- */

__attribute__((used, visibility("default")))
uint8_t* bindweb_scratch_buffer_ptr(void);

__attribute__((used, visibility("default")))
uint32_t bindweb_scratch_buffer_capacity(void);

__attribute__((used, visibility("default")))
const uint8_t* bindweb_scratch_buffer_data(void);

/* ----------------------------------------------------------------------------
 * Flush
 * ---------------------------------------------------------------------------- */

__attribute__((used, visibility("default")))
void bindweb_flush(void);

/* ----------------------------------------------------------------------------
 * Allocator
 * ---------------------------------------------------------------------------- */

__attribute__((used, visibility("default")))
void* bindweb_malloc(size_t size);

__attribute__((used, visibility("default")))
void bindweb_free(void* ptr);

/* ----------------------------------------------------------------------------
 * Libc Stubs (provided because we compile with -nostdlib)
 * ---------------------------------------------------------------------------- */

__attribute__((used, visibility("default")))
size_t strlen(const char* s);

__attribute__((used, visibility("default")))
void* memcpy(void* dest, const void* src, size_t n);

__attribute__((used, visibility("default")))
void* memset(void* dest, int c, size_t n);

__attribute__((used, visibility("default")))
void* memmove(void* dest, const void* src, size_t n);

#ifdef __cplusplus
}
#endif

#endif /* BINDWEB_RUNTIME_H */
