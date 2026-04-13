import React, { useState, useEffect } from 'react';
import { motion, useDragControls } from 'motion/react';
import { AudioEngine } from '../core/audio/AudioEngine';
import { Settings2, X, Music, Piano, Volume2, SlidersHorizontal } from 'lucide-react';

export const VolumeController: React.FC = () => {
    const [isVisible, setIsVisible] = useState(false);
    const dragControls = useDragControls();
    const [state, setState] = useState({
        volumes: { master: 14, lead: 0, bass: 7, accomp: 2 },
        eq: {
            lead: { low: 0, mid: 2, high: 1 },
            piano: { low: 2, mid: -3, high: -6 }
        },
        effects: {
            reverbWet: 0.35, reverbRoomSize: 0.8,
            hallWet: 0.15, hallSize: 2.4,
            filterFreq: 3500, compThreshold: -18, compRatio: 3
        },
        system: {
            hardwareLofi: 0
        }
    });

    // Handle Q+E shortcut
    useEffect(() => {
        const keysPressed = new Set<string>();

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.repeat) return;
            keysPressed.add(e.key.toLowerCase());
            if (keysPressed.has('q') && keysPressed.has('e')) {
                setIsVisible(prev => !prev);
            }
        };

        const handleKeyUp = (e: KeyboardEvent) => {
            keysPressed.delete(e.key.toLowerCase());
        };

        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);

        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
        };
    }, []);

    // Load initial state when visible
    useEffect(() => {
        if (isVisible) {
            try {
                const currentState = AudioEngine.getMixerState();
                if (currentState) {
                    setState(currentState as any);
                }
            } catch (e) {
                console.warn("AudioEngine not fully initialized yet.");
            }
        }
    }, [isVisible]);

    const handleParamChange = (category: string, param: string, value: number) => {
        setState(prev => {
            const next = { ...prev };
            if (category === 'volumes') (next as any).volumes[param] = value;
            else if (category === 'eq') {
                const [inst, band] = param.split('.');
                (next as any).eq[inst][band] = value;
            }
            else if (category === 'effects') (next as any).effects[param] = value;
            else if (category === 'system') (next as any).system[param] = value;
            return next;
        });
        AudioEngine.setMixerParam(category, param, value);
    };

    if (!isVisible) return null;

    return (
        <motion.div
            drag
            dragControls={dragControls}
            dragListener={false}
            dragMomentum={false}
            initial={{ opacity: 0, scale: 0.9, y: 50 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 50 }}
            className="fixed z-50 top-20 right-20 flex flex-col"
            style={{ resize: 'both', overflow: 'hidden', minWidth: '480px', minHeight: '400px' }}
        >
            {/* Marshall + Apple Aesthetic Container */}
            <div className="flex-1 flex flex-col bg-zinc-900/90 backdrop-blur-2xl rounded-3xl border border-yellow-600/30 shadow-[0_20px_50px_rgba(0,0,0,0.5)] overflow-hidden relative">
                
                {/* Subtle Leather/Noise Texture Overlay */}
                <div className="absolute inset-0 opacity-[0.03] pointer-events-none" 
                     style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=%220 0 200 200%22 xmlns=%22http://www.w3.org/2000/svg%22%3E%3Cfilter id=%22noiseFilter%22%3E%3CfeTurbulence type=%22fractalNoise%22 baseFrequency=%220.65%22 numOctaves=%223%22 stitchTiles=%22stitch%22/%3E%3C/filter%3E%3Crect width=%22100%25%22 height=%22100%25%22 filter=%22url(%23noiseFilter)%22/%3E%3C/svg%3E")' }}>
                </div>

                {/* Header (Draggable Area) */}
                <div 
                    className="flex items-center justify-between px-5 py-4 border-b border-yellow-600/20 cursor-grab active:cursor-grabbing bg-gradient-to-b from-zinc-800/50 to-transparent"
                    onPointerDown={(e) => dragControls.start(e)}
                >
                    <div className="flex items-center gap-2">
                        <Settings2 className="w-5 h-5 text-yellow-500" />
                        <h3 className="text-yellow-500 font-medium tracking-widest text-sm uppercase" style={{ fontFamily: 'Impact, sans-serif', letterSpacing: '0.15em' }}>
                            Marshall <span className="text-zinc-400 text-xs font-sans tracking-normal capitalize">Mixer</span>
                        </h3>
                    </div>
                    <button onClick={() => setIsVisible(false)} className="text-zinc-400 hover:text-white transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Scrollable Content Area */}
                <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-8 custom-scrollbar">
                    
                    {/* Volumes Section */}
                    <section>
                        <div className="flex items-center gap-2 mb-4 text-yellow-500/80">
                            <Volume2 className="w-4 h-4" />
                            <h4 className="text-xs font-bold uppercase tracking-widest">Volumes</h4>
                            <div className="flex-1 h-px bg-yellow-500/10 ml-2"></div>
                        </div>
                        <div className="flex justify-around items-end h-48">
                            <VerticalSlider label="Master" icon={<Volume2 className="w-4 h-4" />} value={state.volumes.master} onChange={(v) => handleParamChange('volumes', 'master', v)} min={-60} max={30} />
                            <VerticalSlider label="Lead" icon={<Music className="w-4 h-4" />} value={state.volumes.lead} onChange={(v) => handleParamChange('volumes', 'lead', v)} min={-60} max={10} />
                            <VerticalSlider label="Bass" icon={<Piano className="w-4 h-4" />} value={state.volumes.bass} onChange={(v) => handleParamChange('volumes', 'bass', v)} min={-60} max={10} />
                            <VerticalSlider label="Accomp" icon={<Piano className="w-4 h-4" />} value={state.volumes.accomp} onChange={(v) => handleParamChange('volumes', 'accomp', v)} min={-60} max={10} />
                        </div>
                    </section>

                    {/* EQ Section */}
                    <section>
                        <div className="flex items-center gap-2 mb-4 text-yellow-500/80">
                            <SlidersHorizontal className="w-4 h-4" />
                            <h4 className="text-xs font-bold uppercase tracking-widest">Equalizer</h4>
                            <div className="flex-1 h-px bg-yellow-500/10 ml-2"></div>
                        </div>
                        <div className="grid grid-cols-2 gap-6">
                            <div className="bg-black/20 p-4 rounded-xl border border-white/5">
                                <div className="text-[10px] text-zinc-400 uppercase tracking-wider text-center mb-4">Lead EQ</div>
                                <div className="flex justify-around">
                                    <Knob label="Low" value={state.eq.lead.low} min={-20} max={20} onChange={(v) => handleParamChange('eq', 'lead.low', v)} />
                                    <Knob label="Mid" value={state.eq.lead.mid} min={-20} max={20} onChange={(v) => handleParamChange('eq', 'lead.mid', v)} />
                                    <Knob label="High" value={state.eq.lead.high} min={-20} max={20} onChange={(v) => handleParamChange('eq', 'lead.high', v)} />
                                </div>
                            </div>
                            <div className="bg-black/20 p-4 rounded-xl border border-white/5">
                                <div className="text-[10px] text-zinc-400 uppercase tracking-wider text-center mb-4">Piano EQ</div>
                                <div className="flex justify-around">
                                    <Knob label="Low" value={state.eq.piano.low} min={-20} max={20} onChange={(v) => handleParamChange('eq', 'piano.low', v)} />
                                    <Knob label="Mid" value={state.eq.piano.mid} min={-20} max={20} onChange={(v) => handleParamChange('eq', 'piano.mid', v)} />
                                    <Knob label="High" value={state.eq.piano.high} min={-20} max={20} onChange={(v) => handleParamChange('eq', 'piano.high', v)} />
                                </div>
                            </div>
                        </div>
                    </section>

                    {/* Master FX Section */}
                    <section>
                        <div className="flex items-center gap-2 mb-4 text-yellow-500/80">
                            <Settings2 className="w-4 h-4" />
                            <h4 className="text-xs font-bold uppercase tracking-widest">Master FX</h4>
                            <div className="flex-1 h-px bg-yellow-500/10 ml-2"></div>
                        </div>
                        <div className="bg-black/20 p-4 rounded-xl border border-white/5 grid grid-cols-4 gap-y-6">
                            <Knob label="Rev Wet" value={state.effects.reverbWet} min={0} max={1} step={0.01} onChange={(v) => handleParamChange('effects', 'reverbWet', v)} />
                            <Knob label="Rev Size" value={state.effects.reverbRoomSize} min={0.1} max={1} step={0.01} onChange={(v) => handleParamChange('effects', 'reverbRoomSize', v)} />
                            <Knob label="Hall Wet" value={state.effects.hallWet} min={0} max={1} step={0.01} onChange={(v) => handleParamChange('effects', 'hallWet', v)} />
                            <Knob label="Hall Size" value={state.effects.hallSize} min={0.1} max={5} step={0.1} onChange={(v) => handleParamChange('effects', 'hallSize', v)} />
                            
                            <Knob label="Filter" value={state.effects.filterFreq} min={200} max={20000} step={100} onChange={(v) => handleParamChange('effects', 'filterFreq', v)} />
                            <Knob label="Cmp Thr" value={state.effects.compThreshold} min={-60} max={0} step={1} onChange={(v) => handleParamChange('effects', 'compThreshold', v)} />
                            <Knob label="Cmp Rat" value={state.effects.compRatio} min={1} max={20} step={0.5} onChange={(v) => handleParamChange('effects', 'compRatio', v)} />
                        </div>
                    </section>

                    {/* Hardware Simulation Section */}
                    <section>
                        <div className="flex items-center gap-2 mb-4 text-yellow-500/80">
                            <Settings2 className="w-4 h-4" />
                            <h4 className="text-xs font-bold uppercase tracking-widest">Hardware Sim</h4>
                            <div className="flex-1 h-px bg-yellow-500/10 ml-2"></div>
                        </div>
                        <div className="bg-black/20 p-4 rounded-xl border border-white/5 flex items-center justify-between">
                            <div>
                                <div className="text-sm font-bold text-zinc-300">ESP32-S3 Lo-Fi Mode</div>
                                <div className="text-[10px] text-zinc-500 mt-1">Simulates 16kHz sample rate & 8-bit depth</div>
                            </div>
                            <button 
                                onClick={() => handleParamChange('system', 'hardwareLofi', state.system.hardwareLofi === 1 ? 0 : 1)}
                                className={`w-12 h-6 rounded-full transition-colors relative ${state.system.hardwareLofi === 1 ? 'bg-yellow-600' : 'bg-zinc-700'}`}
                            >
                                <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${state.system.hardwareLofi === 1 ? 'left-7' : 'left-1'}`} />
                            </button>
                        </div>
                    </section>
                </div>
                
                {/* Resize Handle Indicator */}
                <div className="absolute bottom-1 right-1 w-3 h-3 cursor-se-resize opacity-30">
                    <svg viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M8 10V8H10V10H8ZM5 10V8H7V10H5ZM8 7V5H10V7H8ZM2 10V8H4V10H2ZM5 7V5H7V7H5ZM8 4V2H10V4H8Z" fill="currentColor"/>
                    </svg>
                </div>
            </div>
            <style dangerouslySetInnerHTML={{__html: `
                .custom-scrollbar::-webkit-scrollbar { width: 6px; }
                .custom-scrollbar::-webkit-scrollbar-track { background: rgba(0,0,0,0.2); border-radius: 4px; }
                .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(234,179,8,0.3); border-radius: 4px; }
                .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(234,179,8,0.5); }
            `}} />
        </motion.div>
    );
};

interface VerticalSliderProps {
    label: string;
    icon: React.ReactNode;
    value: number;
    min: number;
    max: number;
    onChange: (val: number) => void;
}

const VerticalSlider: React.FC<VerticalSliderProps> = ({ label, icon, value, min, max, onChange }) => {
    const percentage = ((value - min) / (max - min)) * 100;

    return (
        <div className="flex flex-col items-center gap-4 h-full w-16">
            <div className="text-xs font-mono text-yellow-500/80 bg-black/40 px-2 py-1 rounded border border-yellow-600/20 shadow-inner">
                {value > -50 ? `${value > 0 ? '+' : ''}${value.toFixed(1)}` : '-∞'}
            </div>
            <div className="relative flex-1 w-8 flex justify-center py-2">
                <div className="absolute inset-y-0 w-1.5 bg-black/60 rounded-full shadow-inner border border-white/5"></div>
                <div 
                    className="absolute bottom-0 w-1.5 bg-gradient-to-t from-yellow-700 to-yellow-400 rounded-full shadow-[0_0_10px_rgba(234,179,8,0.3)]"
                    style={{ height: `${percentage}%` }}
                ></div>
                <input
                    type="range"
                    min={min}
                    max={max}
                    step={0.5}
                    value={value}
                    onChange={(e) => onChange(parseFloat(e.target.value))}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    style={{ writingMode: 'vertical-lr', direction: 'rtl', appearance: 'slider-vertical' }}
                />
                <div 
                    className="absolute w-8 h-4 bg-gradient-to-b from-zinc-300 to-zinc-500 rounded-sm shadow-md border border-zinc-600 pointer-events-none flex items-center justify-center"
                    style={{ bottom: `calc(${percentage}% - 8px)` }}
                >
                    <div className="w-6 h-0.5 bg-black/50 rounded-full"></div>
                </div>
            </div>
            <div className="flex flex-col items-center gap-1 mt-2">
                <div className="text-zinc-500">{icon}</div>
                <span className="text-[10px] font-medium text-zinc-400 uppercase tracking-wider text-center leading-tight">
                    {label.split(' ').map((word, i) => <React.Fragment key={i}>{word}<br/></React.Fragment>)}
                </span>
            </div>
        </div>
    );
};

const Knob: React.FC<{ label: string, value: number, min: number, max: number, step?: number, onChange: (v: number) => void }> = ({ label, value, min, max, step = 1, onChange }) => {
    const handlePointerDown = (e: React.PointerEvent) => {
        e.preventDefault();
        const startY = e.clientY;
        const startVal = value;
        
        const handlePointerMove = (moveEvent: PointerEvent) => {
            const deltaY = startY - moveEvent.clientY;
            const range = max - min;
            // 150px drag = full range
            let newVal = startVal + (deltaY / 150) * range;
            newVal = Math.max(min, Math.min(max, newVal));
            newVal = Math.round(newVal / step) * step;
            onChange(newVal);
        };
        
        const handlePointerUp = () => {
            window.removeEventListener('pointermove', handlePointerMove);
            window.removeEventListener('pointerup', handlePointerUp);
        };
        
        window.addEventListener('pointermove', handlePointerMove);
        window.addEventListener('pointerup', handlePointerUp);
    };

    const percentage = (value - min) / (max - min);
    const rotation = -135 + (percentage * 270);

    return (
        <div className="flex flex-col items-center gap-2">
            <div 
                className="w-10 h-10 rounded-full bg-gradient-to-br from-zinc-700 to-zinc-900 border-2 border-zinc-800 shadow-[0_5px_10px_rgba(0,0,0,0.5),inset_0_1px_1px_rgba(255,255,255,0.2)] relative cursor-ns-resize flex items-center justify-center"
                onPointerDown={handlePointerDown}
            >
                <div 
                    className="absolute w-full h-full"
                    style={{ transform: `rotate(${rotation}deg)` }}
                >
                    <div className="mx-auto mt-1 w-1 h-2.5 bg-yellow-500 rounded-full shadow-[0_0_5px_rgba(234,179,8,0.5)]"></div>
                </div>
                <div className="w-6 h-6 rounded-full bg-gradient-to-br from-zinc-600 to-zinc-800 border border-zinc-900/50"></div>
            </div>
            <div className="text-center">
                <div className="text-[9px] text-zinc-400 uppercase tracking-wider">{label}</div>
                <div className="text-[10px] font-mono text-yellow-500/80">{value.toFixed(step < 1 ? 2 : 0)}</div>
            </div>
        </div>
    );
};
