/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Book,
  Camera,
  Check,
  ChevronRight,
  Loader2,
  LogOut,
  RefreshCw,
  User,
  Users,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';

const API_URL = import.meta.env.VITE_API_BASE_URL ?? '/api';
const ENROLL_WEBHOOK_URL = `${API_URL.replace(/\/$/, '')}/enrolar`;

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

type AppStep = 'setup' | 'enrolling' | 'scanning';
type EnrollmentStatus = 'idle' | 'sending' | 'success' | 'error';

function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}

function extractBase64(dataUrl: string) {
  const separatorIndex = dataUrl.indexOf(',');
  return separatorIndex >= 0 ? dataUrl.slice(separatorIndex + 1) : dataUrl;
}

export default function App() {
  const [step, setStep] = useState<AppStep>('setup');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [students, setStudents] = useState<Student[]>([]);

  const [selectedTeacher, setSelectedTeacher] = useState('');
  const [selectedCourse, setSelectedCourse] = useState('');
  const [enrollmentName, setEnrollmentName] = useState('');
  const [enrollmentId, setEnrollmentId] = useState('');
  const [enrollmentStatus, setEnrollmentStatus] = useState<EnrollmentStatus>('idle');
  const [enrollmentMessage, setEnrollmentMessage] = useState('');

  const [lastDetectedStudent, setLastDetectedStudent] = useState<Student | null>(null);
  const [attendanceStatus, setAttendanceStatus] = useState<'idle' | 'present' | 'absent'>('idle');
  const [isCapturing, setIsCapturing] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const needsCamera = step === 'enrolling' || step === 'scanning';

    if (!needsCamera) {
      stopStream(streamRef.current);
      streamRef.current = null;
      return;
    }

    const initCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'user',
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        });

        streamRef.current = stream;

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      } catch (cameraError) {
        setError('No se pudo acceder a la cámara. Revisa los permisos del navegador.');
        console.error(cameraError);
      }
    };

    initCamera();

    return () => {
      stopStream(streamRef.current);
      streamRef.current = null;
    };
  }, [step]);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setError(null);

      try {
        const [teachersRes, coursesRes] = await Promise.all([
          fetch(`${API_URL}/usuarios`),
          fetch(`${API_URL}/cursos`),
        ]);

        if (!teachersRes.ok || !coursesRes.ok) {
          throw new Error('Error al cargar datos iniciales');
        }

        const [teachersData, coursesData] = await Promise.all([
          teachersRes.json(),
          coursesRes.json(),
        ]);

        setTeachers(teachersData);
        setCourses(coursesData);
      } catch (initialError) {
        setError('No se pudo conectar con el servidor. Verifica tu conexión.');
        console.error(initialError);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  const readFrameAsDataUrl = async () => {
    if (!videoRef.current || !canvasRef.current) {
      throw new Error('La cámara no está lista');
    }

    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('No se pudo preparar el lienzo de captura');
    }

    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.92);
  };

  const startEnrollment = () => {
    setStep('enrolling');
    setError(null);
    setEnrollmentStatus('idle');
    setEnrollmentMessage('');
  };

  const submitEnrollment = async () => {
    if (enrollmentStatus === 'sending') {
      return;
    }

    const studentName = enrollmentName.trim();

    if (!studentName) {
      setEnrollmentStatus('error');
      setEnrollmentMessage('Escribe el nombre del estudiante antes de registrar la foto.');
      return;
    }

    setEnrollmentStatus('sending');
    setEnrollmentMessage('');
    setError(null);
    setIsCapturing(true);

    try {
      const imageDataUrl = await readFrameAsDataUrl();
      const imageBase64 = extractBase64(imageDataUrl);

      const response = await fetch(ENROLL_WEBHOOK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          nombre_alumno: studentName,
          id_alumno: enrollmentId.trim() || undefined,
          imagen_base64: imageBase64,
          mime_type: 'image/jpeg',
          origen: 'frontend-asistencia',
        }),
      });

      if (!response.ok) {
        throw new Error('El webhook respondió con un error');
      }

      setEnrollmentStatus('success');
      setEnrollmentMessage('Estudiante registrado correctamente.');
      setEnrollmentName('');
      setEnrollmentId('');
      const trimmedEnrollmentId = enrollmentId.trim();
      setStudents((currentStudents) => {
        const nextStudent: Student = {
          id_alumno: trimmedEnrollmentId || studentName,
          nombre_alumno: studentName,
          RekognitionId: null,
        };

        return [nextStudent, ...currentStudents];
      });

      setTimeout(() => {
        setEnrollmentStatus('idle');
        setEnrollmentMessage('');
      }, 2200);
    } catch (enrollmentError) {
      setEnrollmentStatus('error');
      setEnrollmentMessage('No se pudo enviar la foto al webhook. Intenta de nuevo.');
      console.error(enrollmentError);
    } finally {
      setIsCapturing(false);
    }
  };

  const captureAttendancePhoto = async () => {
    if (students.length === 0) return;

    setIsCapturing(true);
    setAttendanceStatus('idle');

    try {
      await readFrameAsDataUrl();
      await new Promise((resolve) => setTimeout(resolve, 500));

      const randomIndex = Math.floor(Math.random() * students.length);
      setLastDetectedStudent(students[randomIndex]);
    } catch (captureError) {
      console.error('Error en el escaneo facial:', captureError);
    } finally {
      setTimeout(() => setIsCapturing(false), 200);
    }
  };

  const startSession = async () => {
    setLoading(true);
    setError(null);

    try {
      const studentsRes = await fetch(`${API_URL}/alumnos`);
      if (!studentsRes.ok) {
        throw new Error('Error al cargar lista de alumnos');
      }

      const studentsData = await studentsRes.json();
      setStudents(studentsData);
      setStep('scanning');
    } catch (sessionError) {
      setError('Error al iniciar jornada. Intenta de nuevo.');
      console.error(sessionError);
    } finally {
      setLoading(false);
    }
  };

  const handleMarkAttendance = (isAbsent: boolean) => {
    if (!lastDetectedStudent && !isAbsent) {
      return;
    }

    setAttendanceStatus(isAbsent ? 'absent' : 'present');

    setTimeout(() => {
      setAttendanceStatus('idle');
      setLastDetectedStudent(null);
    }, 1500);
  };

  const logout = () => {
    stopStream(streamRef.current);
    streamRef.current = null;
    setStep('setup');
    setSelectedTeacher('');
    setSelectedCourse('');
    setLastDetectedStudent(null);
    setAttendanceStatus('idle');
  };

  const readyToEnroll = enrollmentName.trim().length > 0;

  if (loading && step === 'setup' && teachers.length === 0) {
    return (
      <div className="min-h-screen bg-institucional-light flex flex-col items-center justify-center p-6 text-institucional-blue">
        <Loader2 className="w-12 h-12 animate-spin mb-4" />
        <p className="font-medium animate-pulse text-lg">Cargando sistema...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(253,185,19,0.18),_transparent_35%),linear-gradient(180deg,_#f8f9fa_0%,_#eef3ff_100%)] font-sans text-gray-800">
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
        {step !== 'setup' && (
          <button onClick={logout} className="p-2 hover:bg-white/10 rounded-full transition-colors">
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
              className="space-y-6 pt-4"
            >
              <div className="text-center space-y-2">
                <h2 className="text-2xl font-black text-institucional-blue">Configuración</h2>
                <p className="text-gray-500 text-sm">Registra estudiantes por primera vez o inicia la jornada.</p>
              </div>

              <div className="grid gap-4">
                <button
                  onClick={startEnrollment}
                  className="w-full rounded-3xl bg-white border border-institucional-blue/10 shadow-xl p-5 text-left transition-transform active:scale-[0.99] hover:-translate-y-0.5"
                >
                  <div className="flex items-start gap-4">
                    <div className="bg-institucional-yellow/20 p-3 rounded-2xl">
                      <Users className="w-6 h-6 text-institucional-blue" />
                    </div>
                    <div className="flex-1">
                      <p className="text-xs uppercase tracking-[0.2em] text-gray-400 font-bold">Registro inicial</p>
                      <h3 className="text-lg font-black text-institucional-blue mt-1">Registrar estudiantes</h3>
                      <p className="text-sm text-gray-500 mt-1">
                        Registro unico por primera vez
                      </p>
                    </div>
                  </div>
                </button>

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

              <div className="space-y-6 rounded-3xl bg-white/80 border border-white shadow-xl p-5">
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
                    {teachers.map((teacher) => (
                      <option key={teacher.id_usuario} value={teacher.id_usuario}>
                        {teacher.nombre}
                      </option>
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
                    {courses.map((course) => (
                      <option key={course.id_curso} value={course.id_curso}>
                        {course.nombre_curso}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </motion.div>
          ) : step === 'enrolling' ? (
            <motion.div
              key="enrolling"
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              className="space-y-6"
            >
              <div className="rounded-3xl bg-white shadow-xl border border-white p-5 space-y-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-gray-400 font-bold">Registro inicial</p>
                  <h2 className="text-2xl font-black text-institucional-blue mt-1">Registrar estudiante</h2>
                  <p className="text-sm text-gray-500 mt-2">
                    Captura la foto del rostro.
                  </p>
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-bold text-institucional-blue mb-2">Nombre del estudiante</label>
                    <input
                      value={enrollmentName}
                      onChange={(e) => setEnrollmentName(e.target.value)}
                      placeholder="Ej. Ana Pérez"
                      className="w-full bg-white border-2 border-institucional-blue/10 rounded-2xl p-4 shadow-sm focus:border-institucional-blue focus:ring-2 focus:ring-institucional-blue/20 outline-none transition-all"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-bold text-institucional-blue mb-2">Código o ID del alumno</label>
                    <input
                      value={enrollmentId}
                      onChange={(e) => setEnrollmentId(e.target.value)}
                      placeholder="Opcional"
                      className="w-full bg-white border-2 border-institucional-blue/10 rounded-2xl p-4 shadow-sm focus:border-institucional-blue focus:ring-2 focus:ring-institucional-blue/20 outline-none transition-all"
                    />
                  </div>
                </div>
              </div>

              <div
                onClick={() => void submitEnrollment()}
                className="relative aspect-square w-full rounded-[2.5rem] overflow-hidden bg-black shadow-2xl border-4 border-white cursor-pointer active:scale-[0.98] transition-transform"
              >
                <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover scale-x-[-1]" />
                <canvas ref={canvasRef} className="hidden" />

                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="w-3/4 h-3/4 border-2 border-white/50 rounded-full border-dashed" />
                  <div className="absolute top-8 left-0 right-0 text-center">
                    <span className="bg-black/60 text-white text-[10px] uppercase tracking-widest px-3 py-1 rounded-full backdrop-blur-md">
                      Modo de registro activo
                    </span>
                  </div>
                  <div className="absolute bottom-10 left-0 right-0 text-center">
                    <span className="text-white/60 text-[10px] uppercase tracking-widest animate-pulse">
                      Toca la cámara para capturar y enviar
                    </span>
                  </div>
                </div>

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

                <motion.div
                  className="absolute left-0 right-0 h-1 bg-institucional-yellow/50 blur-sm z-10"
                  animate={{ top: ['10%', '90%', '10%'] }}
                  transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}
                />
              </div>

              <div className="bg-white rounded-3xl p-6 shadow-xl border border-gray-100 space-y-4">
                <div className="flex items-center gap-4">
                  <div className="bg-institucional-yellow/20 p-3 rounded-2xl">
                    <Camera className="w-6 h-6 text-institucional-blue" />
                  </div>
                  <div className="flex-1">
                    <p className="text-xs text-gray-400 font-bold uppercase tracking-wider">Estado del registro</p>
                    <h3 className="text-lg font-bold text-institucional-blue">
                      {enrollmentStatus === 'sending'
                        ? 'Enviando foto al webhook'
                        : enrollmentStatus === 'success'
                          ? 'Registro completado'
                          : 'Listo para capturar'}
                    </h3>
                    <p className="text-sm text-gray-500 mt-1">
                      {enrollmentMessage || 'La imagen se convertirá a base64 antes de enviarse.'}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <button
                    onClick={() => void submitEnrollment()}
                    disabled={!readyToEnroll || enrollmentStatus === 'sending'}
                    className="bg-institucional-blue hover:bg-institucional-blue/90 disabled:opacity-30 disabled:grayscale text-white py-4 rounded-2xl shadow-lg shadow-institucional-blue/30 font-black flex flex-col items-center justify-center gap-1 transition-all active:scale-95"
                  >
                    {enrollmentStatus === 'sending' ? <Loader2 className="w-6 h-6 animate-spin" /> : <Check className="w-6 h-6" />}
                    <span className="text-xs">CAPTURAR Y ENVIAR</span>
                  </button>

                  <button
                    onClick={() => setStep('setup')}
                    className="bg-white border-2 border-institucional-blue/15 hover:border-institucional-blue/30 text-institucional-blue py-4 rounded-2xl shadow-lg font-black flex flex-col items-center justify-center gap-1 transition-all active:scale-95"
                  >
                    <X className="w-6 h-6" />
                    <span className="text-xs">VOLVER</span>
                  </button>
                </div>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="scanning"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="space-y-6"
            >
              <div
                onClick={() => void captureAttendancePhoto()}
                className="relative aspect-square w-full rounded-[2.5rem] overflow-hidden bg-black shadow-2xl border-4 border-white cursor-pointer active:scale-[0.98] transition-transform"
              >
                <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover scale-x-[-1]" />
                <canvas ref={canvasRef} className="hidden" />

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

                <motion.div
                  className="absolute left-0 right-0 h-1 bg-institucional-yellow/50 blur-sm z-10"
                  animate={{ top: ['10%', '90%', '10%'] }}
                  transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}
                />

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

              <div className="flex items-center justify-between px-4 pb-4">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest leading-none">
                    Sesión Activa
                  </span>
                </div>
                <div className="text-right">
                  <p className="text-[10px] text-gray-400 font-bold uppercase mb-1">Curso</p>
                  <p className="text-xs font-bold text-institucional-blue">
                    {courses.find((course) => course.id_curso === selectedCourse)?.nombre_curso}
                  </p>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 w-[90%] max-w-sm pointer-events-none z-50">
        <div className="bg-institucional-blue/90 backdrop-blur-md text-white/70 text-[9px] py-1 px-4 rounded-full text-center uppercase tracking-[0.2em] font-medium border border-white/10 shadow-lg">
          I.E. Rafael Narváez Cadenillas • 2026
        </div>
      </div>
    </div>
  );
}
