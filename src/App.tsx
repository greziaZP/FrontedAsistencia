/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef } from 'react';
import { 
  Camera, 
  User, 
  Book, 
  Check, 
  X, 
  ChevronRight, 
  Loader2, 
  AlertCircle,
  RefreshCw,
  LogOut
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

const API_URL = import.meta.env.VITE_API_BASE_URL;

// Types based on the actual API responses
interface Teacher {
  id_usuario: string;
  nombre: string;
  rol: string;
  email: string;
}

interface Course {
  id_curso: string;
  nombre_curso: string;
}

interface Student {
  id_alumno: string;
  nombre_alumno: string;
  RekognitionId: string | null;
}

type AppStep = 'setup' | 'scanning';

export default function App() {
  const [step, setStep] = useState<AppStep>('setup');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Data states
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [students, setStudents] = useState<Student[]>([]);

  // Selection states
  const [selectedTeacher, setSelectedTeacher] = useState<string>('');
  const [selectedCourse, setSelectedCourse] = useState<string>('');
  
  const [lastDetectedStudent, setLastDetectedStudent] = useState<Student | null>(null);
  const [attendanceStatus, setAttendanceStatus] = useState<'idle' | 'present' | 'absent'>('idle');
  const [isCapturing, setIsCapturing] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Manage Camera Stream
  useEffect(() => {
    if (step === 'scanning') {
      const initCamera = async () => {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ 
            video: { 
              facingMode: 'user',
              width: { ideal: 1280 },
              height: { ideal: 720 }
            } 
          });
          streamRef.current = stream;
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
          }
        } catch (err) {
          setError('No se pudo acceder a la cámara. Asegúrate de dar los permisos necesarios.');
          console.error(err);
        }
      };
      
      initCamera();
    } else {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
    }

    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, [step]);

  // Ensure stream is attached if video element re-renders
  useEffect(() => {
    if (step === 'scanning' && videoRef.current && streamRef.current && !videoRef.current.srcObject) {
      videoRef.current.srcObject = streamRef.current;
    }
  }, [step, videoRef.current, streamRef.current]);

  // Initial data fetch
  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        const [teachersRes, coursesRes] = await Promise.all([
          fetch(`${API_URL}/usuarios`),
          fetch(`${API_URL}/cursos`)
        ]);

        if (!teachersRes.ok || !coursesRes.ok) throw new Error('Error al cargar datos iniciales');

        const teachersData = await teachersRes.json();
        const coursesData = await coursesRes.json();

        setTeachers(teachersData);
        setCourses(coursesData);
      } catch (err) {
        setError('No se pudo conectar con el servidor. Verifica tu conexión.');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  const capturePhoto = async () => {
    if (!videoRef.current || !canvasRef.current || students.length === 0) return;

    setIsCapturing(true);
    setAttendanceStatus('idle'); // Clear previous status
    
    const canvas = canvasRef.current;
    const video = videoRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    
    if (ctx) {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      
      console.log('Procesando escaneo facial...');
      
      try {
        // Simulate API processing delay
        await new Promise(resolve => setTimeout(resolve, 600));
        
        // Simulate finding a student
        const randomIndex = Math.floor(Math.random() * students.length);
        setLastDetectedStudent(students[randomIndex]);
        
        console.log('Estudiante reconocido:', students[randomIndex].nombre_alumno);
      } catch (err) {
        console.error('Error en el escaneo facial:', err);
      }
    }

    setTimeout(() => setIsCapturing(false), 200);
  };

  // Fetch students when moving to scanning
  const startSession = async () => {
    setLoading(true);
    try {
      const studentsRes = await fetch(`${API_URL}/alumnos`);
      if (!studentsRes.ok) throw new Error('Error al cargar lista de alumnos');
      const studentsData = await studentsRes.json();
      setStudents(studentsData);
      setStep('scanning');
    } catch (err) {
      setError('Error al iniciar jornada. Intenta de nuevo.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleMarkAttendance = (isAbsent: boolean) => {
    if (!lastDetectedStudent && !isAbsent) return;
    
    setAttendanceStatus(isAbsent ? 'absent' : 'present');
    
    // Auto-clear feedback after 1.5s
    setTimeout(() => {
      setAttendanceStatus('idle');
      setLastDetectedStudent(null);
    }, 1500);
  };

  const logout = () => {
    setStep('setup');
    setSelectedTeacher('');
    setSelectedCourse('');
    setLastDetectedStudent(null);
  };

  if (loading && step === 'setup' && teachers.length === 0) {
    return (
      <div className="min-h-screen bg-institucional-light flex flex-col items-center justify-center p-6 text-institucional-blue">
        <Loader2 className="w-12 h-12 animate-spin mb-4" />
        <p className="font-medium animate-pulse text-lg">Cargando Sistema...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-institucional-light font-sans text-gray-800">
      {/* Header */}
      <header className="bg-institucional-blue text-white p-4 shadow-lg flex items-center justify-between sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <div className="bg-institucional-yellow p-2 rounded-lg">
            <User className="text-institucional-blue w-6 h-6" />
          </div>
          <div>
            <h1 className="text-lg font-bold leading-tight">Rafael Narváez</h1>
            <p className="text-xs text-institucional-yellow font-medium">Control de Asistencia</p>
          </div>
        </div>
        {step === 'scanning' && (
          <button 
            onClick={logout}
            className="p-2 hover:bg-white/10 rounded-full transition-colors"
          >
            <LogOut className="w-5 h-5" />
          </button>
        )}
      </header>

      <main className="max-w-md mx-auto p-4 pb-24">
        {error && (
          <div className="bg-red-50 border-l-4 border-red-500 p-4 mb-6 flex items-start gap-3 rounded-r-lg shadow-sm">
            <AlertCircle className="text-red-500 shrink-0 w-5 h-5" />
            <div className="flex-1">
              <p className="text-red-800 text-sm font-medium">{error}</p>
              <button 
                onClick={() => window.location.reload()}
                className="text-red-600 text-xs mt-2 font-bold underline flex items-center gap-1"
              >
                <RefreshCw className="w-3 h-3" /> Reintentar
              </button>
            </div>
            <button onClick={() => setError(null)} className="text-red-400 p-1">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        <AnimatePresence mode="wait">
          {step === 'setup' ? (
            <motion.div
              key="setup"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-8 pt-4"
            >
              <div className="text-center space-y-2">
                <h2 className="text-2xl font-black text-institucional-blue">Configuración</h2>
                <p className="text-gray-500 text-sm">Selecciona los datos para iniciar la sesión</p>
              </div>

              <div className="space-y-6">
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-sm font-bold text-institucional-blue ml-1">
                    <User className="w-4 h-4" /> Docente
                  </label>
                  <select 
                    value={selectedTeacher}
                    onChange={(e) => setSelectedTeacher(e.target.value)}
                    className="w-full bg-white border-2 border-institucional-blue/10 rounded-2xl p-4 shadow-sm focus:border-institucional-blue focus:ring-2 focus:ring-institucional-blue/20 outline-none transition-all appearance-none cursor-pointer"
                  >
                    <option value="">Seleccionar Docente</option>
                    {teachers.map((t) => (
                      <option key={t.id_usuario} value={t.id_usuario}>{t.nombre}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-sm font-bold text-institucional-blue ml-1">
                    <Book className="w-4 h-4" /> Curso / Periodo
                  </label>
                  <select 
                    value={selectedCourse}
                    onChange={(e) => setSelectedCourse(e.target.value)}
                    className="w-full bg-white border-2 border-institucional-blue/10 rounded-2xl p-4 shadow-sm focus:border-institucional-blue focus:ring-2 focus:ring-institucional-blue/20 outline-none transition-all appearance-none cursor-pointer"
                  >
                    <option value="">Seleccionar Curso</option>
                    {courses.map((c) => (
                      <option key={c.id_curso} value={c.id_curso}>{c.nombre_curso}</option>
                    ))}
                  </select>
                </div>

                <button
                  disabled={!selectedTeacher || !selectedCourse || loading}
                  onClick={startSession}
                  className="w-full bg-institucional-blue hover:bg-institucional-blue/90 disabled:opacity-30 disabled:grayscale text-white font-black py-4 rounded-2xl shadow-xl shadow-institucional-blue/20 flex items-center justify-center gap-3 transition-all active:scale-95 group"
                >
                  {loading ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <>
                      COMENZAR JORNADA
                      <ChevronRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                    </>
                  )}
                </button>
              </div>

              <div className="pt-8 text-center">
                <img 
                  src="https://picsum.photos/seed/school/400/200" 
                  alt="Colegio Rafael Narvaez" 
                  className="rounded-3xl shadow-lg border-4 border-white grayscale opacity-50"
                  referrerPolicy="no-referrer"
                />
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="scanning"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="space-y-6"
            >
              {/* Camera Container */}
              <div 
                onClick={capturePhoto}
                className="relative aspect-square w-full rounded-[2.5rem] overflow-hidden bg-black shadow-2xl border-4 border-white cursor-pointer active:scale-[0.98] transition-transform"
              >
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover scale-x-[-1]"
                />
                <canvas ref={canvasRef} className="hidden" />
                
                {/* Overlay */}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="w-3/4 h-3/4 border-2 border-white/50 rounded-full border-dashed" />
                  <div className="absolute top-8 left-0 right-0 text-center">
                    <span className="bg-black/60 text-white text-[10px] uppercase tracking-widest px-3 py-1 rounded-full backdrop-blur-md">
                      Escaneo Facial Activo
                    </span>
                  </div>
                  <div className="absolute bottom-10 left-0 right-0 text-center">
                    <span className="text-white/40 text-[10px] uppercase tracking-widest animate-pulse">
                      Toca para capturar
                    </span>
                  </div>
                </div>

                {/* Shutter Flash Effect */}
                <AnimatePresence>
                  {isCapturing && (
                    <motion.div 
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="absolute inset-0 bg-white z-40"
                    />
                  )}
                </AnimatePresence>

                {/* Animated Scanner Beam */}
                <motion.div 
                  className="absolute left-0 right-0 h-1 bg-institucional-yellow/50 blur-sm z-10"
                  animate={{ top: ['10%', '90%', '10%'] }}
                  transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
                />

                {/* Success/Error Overlay */}
                <AnimatePresence>
                  {attendanceStatus !== 'idle' && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className={`absolute inset-0 flex flex-col items-center justify-center z-20 backdrop-blur-sm ${
                        attendanceStatus === 'present' ? 'bg-green-600/30' : 'bg-red-600/30'
                      }`}
                    >
                      <motion.div
                        initial={{ scale: 0, rotate: -45 }}
                        animate={{ scale: 1, rotate: 0 }}
                        className="bg-white p-6 rounded-full shadow-2xl"
                      >
                        {attendanceStatus === 'present' ? (
                          <Check className="w-16 h-16 text-green-600 stroke-[4px]" />
                        ) : (
                          <X className="w-16 h-16 text-red-600 stroke-[4px]" />
                        )}
                      </motion.div>
                      <motion.p
                        initial={{ y: 10, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        className="mt-4 text-white font-black text-xl drop-shadow-md"
                      >
                        {attendanceStatus === 'present' ? '¡ASISTENCIA REGISTRADA!' : 'INASISTENCIA MARCADA'}
                      </motion.p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Student Card */}
              <div className="bg-white rounded-3xl p-6 shadow-xl border border-gray-100 flex flex-col items-center">
                <div className="w-full flex items-center gap-4 mb-6">
                  <div className="bg-institucional-yellow/20 p-3 rounded-2xl">
                    <Camera className="w-6 h-6 text-institucional-blue" />
                  </div>
                  <div className="flex-1">
                    <p className="text-xs text-gray-400 font-bold uppercase tracking-wider">Estudiante Reconocido</p>
                    {lastDetectedStudent ? (
                      <h3 className="text-lg font-bold text-institucional-blue">{lastDetectedStudent.nombre_alumno}</h3>
                    ) : (
                      <p className="text-gray-400 italic">Toca la cámara para escanear</p>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 w-full">
                  <button
                    disabled={!lastDetectedStudent || attendanceStatus !== 'idle'}
                    onClick={() => handleMarkAttendance(false)}
                    className={`py-5 rounded-2xl shadow-lg font-black flex flex-col items-center justify-center gap-1 transition-all active:scale-95 ${
                      lastDetectedStudent 
                        ? 'bg-green-600 text-white shadow-green-600/30' 
                        : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                    }`}
                  >
                    <Check className="w-6 h-6" /> 
                    <span className="text-xs">ASISTENCIA</span>
                  </button>
                  <button
                    disabled={attendanceStatus !== 'idle'}
                    onClick={() => handleMarkAttendance(true)}
                    className="bg-red-600 hover:bg-red-700 disabled:opacity-30 disabled:grayscale text-white py-5 rounded-2xl shadow-lg shadow-red-600/30 font-black flex flex-col items-center justify-center gap-1 transition-all active:scale-95"
                  >
                    <X className="w-6 h-6" /> 
                    <span className="text-xs">INASISTENCIA</span>
                  </button>
                </div>
              </div>

              {/* Session Info */}
              <div className="flex items-center justify-between px-4 pb-4">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest leading-none">Sesión Activa</span>
                </div>
                <div className="text-right">
                  <p className="text-[10px] text-gray-400 font-bold uppercase mb-1">Curso</p>
                  <p className="text-xs font-bold text-institucional-blue">{courses.find(c => c.id_curso === selectedCourse)?.nombre_curso}</p>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Mobile-First Fixed Hint */}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 w-[90%] max-w-sm pointer-events-none z-50">
        <div className="bg-institucional-blue/90 backdrop-blur-md text-white/70 text-[9px] py-1 px-4 rounded-full text-center uppercase tracking-[0.2em] font-medium border border-white/10 shadow-lg">
          I.E. Rafael Narváez Cadenillas • 2026
        </div>
      </div>
    </div>
  );
}
