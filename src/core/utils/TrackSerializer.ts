import { NoteData } from '../generation/types';

/**
 * TrackSerializer (Memory Optimization & C++ Interop)
 * 
 * In JavaScript, arrays of objects (NoteData[]) cause Garbage Collection (GC) overhead
 * and memory fragmentation. On an ESP32-S3, this leads to Out-Of-Memory (OOM) crashes.
 * 
 * This utility demonstrates how to serialize dynamic JS objects into flat, 
 * pre-allocated TypedArrays (Float32Array). This mimics how data MUST be 
 * structured in C++ (arrays of structs) for the ESP32 port.
 */
export class TrackSerializer {
    // C++ Struct Mapping:
    // struct NoteData { float pitch; float onset; float duration; float velocity; };
    // Stride = 4 floats per note
    public static readonly STRIDE = 4;

    /**
     * Converts an array of NoteData objects into a flat Float32Array.
     * This is zero-GC friendly and can be sent directly to a C++ WebAssembly module
     * or used as a reference for ESP32 memory layout.
     */
    public static serializeNotesToBuffer(notes: NoteData[]): Float32Array {
        const buffer = new Float32Array(notes.length * this.STRIDE);
        
        for (let i = 0; i < notes.length; i++) {
            const note = notes[i];
            const offset = i * this.STRIDE;
            
            buffer[offset + 0] = note.pitch;
            buffer[offset + 1] = note.onset;
            buffer[offset + 2] = note.duration;
            buffer[offset + 3] = note.velocity;
        }
        
        return buffer;
    }

    /**
     * Deserializes a flat Float32Array back into JS objects (for simulator playback).
     */
    public static deserializeBufferToNotes(buffer: Float32Array): NoteData[] {
        const notes: NoteData[] = [];
        const noteCount = buffer.length / this.STRIDE;
        
        for (let i = 0; i < noteCount; i++) {
            const offset = i * this.STRIDE;
            notes.push({
                pitch: buffer[offset + 0],
                onset: buffer[offset + 1],
                duration: buffer[offset + 2],
                velocity: buffer[offset + 3]
            });
        }
        
        return notes;
    }
}
