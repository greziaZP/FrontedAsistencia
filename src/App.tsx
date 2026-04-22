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

const DATA_API_URL = import.meta.env.VITE_DATA_API_URL ?? import.meta.env.VITE_API_BASE_URL ?? '/api';
const DATA_API_BASE = DATA_API_URL.replace(/\/$/, '');
const ENROLL_WEBHOOK_URL = import.meta.env.VITE_ENROLL_WEBHOOK_URL ?? `${DATA_API_BASE}/enrolar`;
const ATTENDANCE_WEBHOOK_URL = import.meta.env.VITE_ATTENDANCE_WEBHOOK_URL ?? `${DATA_API_BASE}/identificar`;
const PARENTS_WEBHOOK_URL = import.meta.env.VITE_PARENTS_WEBHOOK_URL ?? `${DATA_API_BASE}/asistencia/padres`;
const CLOSE_ATTENDANCE_WEBHOOK_URL = import.meta.env.VITE_CLOSE_ATTENDANCE_WEBHOOK_URL;

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

interface EnrollmentWebhookResponse {
  id_alumno: string;
  nombre_alumno: string;
  id_padre: string;
  id_tutor: string;
  RekognitionId: string;
  id: number;
  createdAt: string;
  updatedAt: string;
}

interface AttendanceWebhookResponse {
  id_alumno: string;
  estado: string;
  hora_ingreso: string;
  id_curso: string;
  fecha_asistencia: string;
  id: number;
  createdAt: string;
  updatedAt: string;
}

type AppStep = 'setup' | 'enrolling' | 'scanning';
type EnrollmentStatus = 'idle' | 'sending' | 'success' | 'error';
type AttendanceStatus = 'idle' | 'sending' | 'success' | 'error';

function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}

function extractBase64(dataUrl: string) {
  const separatorIndex = dataUrl.indexOf(',');
  return separatorIndex >= 0 ? dataUrl.slice(separatorIndex + 1) : dataUrl;
}

async function waitForVideoFrame(video: HTMLVideoElement) {
  if (video.videoWidth > 0 && video.videoHeight > 0 && video.readyState >= 2) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };

    const fail = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('No se pudo obtener frame de video.'));
    };

    const onReady = () => {
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        finish();
      }
    };

    const timeoutId = window.setTimeout(fail, 2500);

    const cleanup = () => {
      window.clearTimeout(timeoutId);
      video.removeEventListener('loadeddata', onReady);
      video.removeEventListener('canplay', onReady);
      video.removeEventListener('error', fail);
    };

    video.addEventListener('loadeddata', onReady);
    video.addEventListener('canplay', onReady);
    video.addEventListener('error', fail);
    onReady();
  });
}

function readMaybeObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function readFirstString(payload: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const raw = payload[key];
    if (typeof raw === 'string' && raw.trim().length > 0) {
      return raw.trim();
    }
  }
  return '';
}

function parseEnrollmentResponse(payload: Record<string, unknown>): EnrollmentWebhookResponse | null {
  const requiredStrings = ['id_alumno', 'nombre_alumno', 'id_padre', 'id_tutor', 'RekognitionId', 'createdAt', 'updatedAt'];
  const hasRequiredStrings = requiredStrings.every((key) => typeof payload[key] === 'string' && String(payload[key]).trim().length > 0);
  const hasId = typeof payload.id === 'number';

  if (!hasRequiredStrings || !hasId) {
    return null;
  }

  return {
    id_alumno: String(payload.id_alumno),
    nombre_alumno: String(payload.nombre_alumno),
    id_padre: String(payload.id_padre),
    id_tutor: String(payload.id_tutor),
    RekognitionId: String(payload.RekognitionId),
    id: Number(payload.id),
    createdAt: String(payload.createdAt),
    updatedAt: String(payload.updatedAt),
  };
}

function parseAttendanceResponse(payload: Record<string, unknown>): AttendanceWebhookResponse | null {
  const requiredStrings = ['id_alumno', 'estado', 'hora_ingreso', 'id_curso', 'fecha_asistencia', 'createdAt', 'updatedAt'];
  const hasRequiredStrings = requiredStrings.every((key) => typeof payload[key] === 'string' && String(payload[key]).trim().length > 0);
  const hasId = typeof payload.id === 'number';

  if (!hasRequiredStrings || !hasId) {
    return null;
  }

  return {
    id_alumno: String(payload.id_alumno),
    estado: String(payload.estado),
    hora_ingreso: String(payload.hora_ingreso),
    id_curso: String(payload.id_curso),
    fecha_asistencia: String(payload.fecha_asistencia),
    id: Number(payload.id),
    createdAt: String(payload.createdAt),
    updatedAt: String(payload.updatedAt),
  };
}

function getStudentNameFromDuplicateMessage(message: string) {
  const match = message.match(/Alumno\(a\)\s+(.+?)\s+ya\s+marco\s+asistencia/i);
  return match?.[1]?.trim() ?? '';
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
  const [selectedEnrollmentStudentId, setSelectedEnrollmentStudentId] = useState('');
  const [enrollmentStatus, setEnrollmentStatus] = useState<EnrollmentStatus>('idle');
  const [enrollmentMessage, setEnrollmentMessage] = useState('');
  const [lastEnrollmentRecord, setLastEnrollmentRecord] = useState<EnrollmentWebhookResponse | null>(null);

  const [lastDetectedStudent, setLastDetectedStudent] = useState<Student | null>(null);
  const [attendanceStatus, setAttendanceStatus] = useState<AttendanceStatus>('idle');
  const [attendanceMessage, setAttendanceMessage] = useState('');
  const [isClosingAttendance, setIsClosingAttendance] = useState(false);
  const [closeAttendanceMessage, setCloseAttendanceMessage] = useState('');
  const [lastAttendanceResponse, setLastAttendanceResponse] = useState<Record<string, unknown> | null>(null);
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
        const [teachersRes, coursesRes, studentsRes] = await Promise.all([
          fetch(`${DATA_API_BASE}/usuarios`),
          fetch(`${DATA_API_BASE}/cursos`),
          fetch(`${DATA_API_BASE}/alumnos`),
        ]);

        if (!teachersRes.ok || !coursesRes.ok || !studentsRes.ok) {
          throw new Error('Error al cargar datos iniciales');
        }

        const [teachersData, coursesData, studentsData] = await Promise.all([
          teachersRes.json(),
          coursesRes.json(),
          studentsRes.json(),
        ]);

        setTeachers(teachersData);
        setCourses(coursesData);
        setStudents(studentsData);
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
    await waitForVideoFrame(video);

    if (video.videoWidth <= 0 || video.videoHeight <= 0) {
      throw new Error('La cámara aún no entrega una imagen válida.');
    }

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
    setSelectedEnrollmentStudentId('');
    setLastEnrollmentRecord(null);
  };

  const submitEnrollment = async () => {
    if (enrollmentStatus === 'sending') {
      return;
    }

    if (!selectedEnrollmentStudentId) {
      setEnrollmentStatus('error');
      setEnrollmentMessage('Selecciona un alumno antes de registrar la foto.');
      return;
    }

    const selectedStudent = students.find((student) => student.id_alumno === selectedEnrollmentStudentId);

    setEnrollmentStatus('sending');
    setEnrollmentMessage('');
    setError(null);
    setIsCapturing(true);

    try {
      const imageDataUrl = await readFrameAsDataUrl();
      const imageBase64 = extractBase64(imageDataUrl);

      if (imageBase64.length < 100) {
        throw new Error('Base64 inválido o vacío antes de enviar a n8n');
      }

      const response = await fetch(ENROLL_WEBHOOK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          id_alumno: selectedEnrollmentStudentId,
          idAlumno: selectedEnrollmentStudentId,
          ID_ALUMNO: selectedEnrollmentStudentId,
          nombre_alumno: selectedStudent?.nombre_alumno,
          foto_base64: imageBase64,
          imagen_base64: imageBase64,
          image_base64: imageBase64,
          mime_type: 'image/jpeg',
          origen: 'frontend-asistencia',
        }),
      });

      if (!response.ok) {
        throw new Error('El webhook respondió con un error');
      }

      const contentType = response.headers.get('content-type') ?? '';
      let parsedEnrollment: EnrollmentWebhookResponse | null = null;

      if (contentType.includes('application/json')) {
        const payload = readMaybeObject(await response.json());
        parsedEnrollment = parseEnrollmentResponse(payload);
      }

      setEnrollmentStatus('success');
      setEnrollmentMessage('Estudiante registrado correctamente.');
      setLastEnrollmentRecord(parsedEnrollment);
      setSelectedEnrollmentStudentId('');

      setTimeout(() => {
        setEnrollmentStatus('idle');
        setEnrollmentMessage('');
      }, 2200);
    } catch (enrollmentError) {
      setEnrollmentStatus('error');
      setEnrollmentMessage(`No se pudo enviar la foto al webhook (${ENROLL_WEBHOOK_URL}).`);
      console.error('Error enviando enrolamiento', {
        webhook: ENROLL_WEBHOOK_URL,
        error: enrollmentError,
      });
    } finally {
      setIsCapturing(false);
    }
  };

  const captureAttendancePhoto = async () => {
    if (!selectedTeacher || !selectedCourse || attendanceStatus === 'sending') return;

    setIsCapturing(true);
    setAttendanceStatus('sending');
    setAttendanceMessage('Enviando foto para reconocimiento...');
    setLastAttendanceResponse(null);
    setLastDetectedStudent(null);

    try {
      const imageDataUrl = await readFrameAsDataUrl();
      const imageBase64 = extractBase64(imageDataUrl);

      const response = await fetch(ATTENDANCE_WEBHOOK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          id_docente: selectedTeacher,
          idDocente: selectedTeacher,
          id_curso: selectedCourse,
          idCurso: selectedCourse,
          foto_base64: imageBase64,
          imagen_base64: imageBase64,
          image_base64: imageBase64,
          mime_type: 'image/jpeg',
          origen: 'frontend-asistencia',
        }),
      });

      if (!response.ok) {
        throw new Error('El webhook de asistencia respondió con error');
      }

      const contentType = response.headers.get('content-type') ?? '';
      let payload: Record<string, unknown> = {};
      let attendanceRecord: AttendanceWebhookResponse | null = null;
      let duplicateMessage = '';

      if (contentType.includes('application/json')) {
        payload = readMaybeObject(await response.json());
        attendanceRecord = parseAttendanceResponse(payload);
        duplicateMessage = readFirstString(payload, ['message', 'mensaje']);
      }

      const detectedId = attendanceRecord?.id_alumno || readFirstString(payload, [
        'id_alumno',
        'idAlumno',
        'ID_ALUMNO',
        'alumno_id',
        'student_id',
        'rekognition_id',
        'rekognitionId',
      ]);
      let detectedName = readFirstString(payload, [
        'nombre_alumno',
        'nombreAlumno',
        'alumno_nombre',
        'student_name',
      ]);

      if (!detectedName && duplicateMessage) {
        detectedName = getStudentNameFromDuplicateMessage(duplicateMessage);
      }

      const detectedStudent = students.find(
        (student) =>
          student.id_alumno === detectedId ||
          student.RekognitionId === detectedId,
      );

      setLastAttendanceResponse(payload);

      if (detectedStudent) {
        setLastDetectedStudent(detectedStudent);
      } else if (detectedId || detectedName) {
        setLastDetectedStudent({
          id_alumno: detectedId || 'sin-id',
          nombre_alumno: detectedName || 'Alumno detectado',
          RekognitionId: detectedId || null,
        });
      } else {
        setLastDetectedStudent(null);
      }

      setAttendanceStatus('success');

      if (attendanceRecord) {
        const courseName = courses.find((c) => c.id_curso === selectedCourse)?.nombre_curso || selectedCourse;
        setAttendanceMessage(`✓ ${detectedName || attendanceRecord.id_alumno} en ${courseName} (${attendanceRecord.estado})`);
      } else if (duplicateMessage) {
        const courseName = courses.find((c) => c.id_curso === selectedCourse)?.nombre_curso || selectedCourse;
        const studentNameFromMessage = getStudentNameFromDuplicateMessage(duplicateMessage);
        setAttendanceMessage(`${studentNameFromMessage} registrado en ${courseName}`);
      } else {
        setAttendanceMessage('Respuesta recibida desde n8n.');
      }

      window.setTimeout(() => {
        setAttendanceStatus('idle');
      }, 1700);
    } catch (captureError) {
      setAttendanceStatus('error');
      setAttendanceMessage(`No se pudo registrar asistencia (${ATTENDANCE_WEBHOOK_URL}).`);
      setLastDetectedStudent(null);
      console.error('Error en el escaneo facial', {
        webhook: ATTENDANCE_WEBHOOK_URL,
        error: captureError,
      });
    } finally {
      setTimeout(() => setIsCapturing(false), 200);
    }
  };

  const startSession = async () => {
    setLoading(true);
    setError(null);

    try {
      if (students.length === 0) {
        const studentsRes = await fetch(`${DATA_API_BASE}/alumnos`);
        if (!studentsRes.ok) {
          throw new Error('Error al cargar lista de alumnos');
        }

        const studentsData = await studentsRes.json();
        setStudents(studentsData);
      }

      setLastDetectedStudent(null);
      setAttendanceStatus('idle');
      setAttendanceMessage('');
      setStep('scanning');
    } catch (sessionError) {
      setStep('scanning');
      setAttendanceMessage('No se pudo refrescar alumnos, pero la jornada se inició igual.');
      setError(null);
      console.error(sessionError);
    } finally {
      setLoading(false);
    }
  };

  const closeAttendance = async () => {
    if (isClosingAttendance) {
      return;
    }

    setIsClosingAttendance(true);
    setCloseAttendanceMessage('Cerrando asistencia y notificando...');

    try {
      const response = await fetch(CLOSE_ATTENDANCE_WEBHOOK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          id_docente: selectedTeacher,
          idDocente: selectedTeacher,
          id_curso: selectedCourse,
          idCurso: selectedCourse,
          origen: 'frontend-asistencia',
        }),
      });

      if (!response.ok) {
        throw new Error('Webhook de cierre respondió con error');
      }

      setCloseAttendanceMessage('Asistencia cerrada correctamente.');
    } catch (closeError) {
      setCloseAttendanceMessage(`No se pudo cerrar asistencia (${CLOSE_ATTENDANCE_WEBHOOK_URL}).`);
      console.error('Error cerrando asistencia', {
        webhook: CLOSE_ATTENDANCE_WEBHOOK_URL,
        error: closeError,
      });
    } finally {
      setIsClosingAttendance(false);
    }
  };

  const logout = () => {
    stopStream(streamRef.current);
    streamRef.current = null;
    setStep('setup');
    setSelectedEnrollmentStudentId('');
    setLastDetectedStudent(null);
    setAttendanceStatus('idle');
    setAttendanceMessage('');
  };

  const readyToEnroll = selectedEnrollmentStudentId.length > 0;

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

                  <div className="pt-2">
                    <button
                      disabled={isClosingAttendance}
                      onClick={() => void closeAttendance()}
                      className="w-full bg-red-600 hover:bg-red-700 disabled:opacity-30 disabled:grayscale text-white font-black py-3 rounded-2xl shadow-lg shadow-red-600/20 transition-all active:scale-95"
                    >
                      {isClosingAttendance ? 'Enviando' : 'Notificar Inasistencias'}
                    </button>
                    {closeAttendanceMessage && (
                      <p className="text-xs text-gray-500 mt-2 text-center">{closeAttendanceMessage}</p>
                    )}
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
                      Selecciona el alumno y captura la foto del rostro.
                  </p>
                </div>

                  <div className="space-y-2">
                    <label className="flex items-center gap-2 text-sm font-bold text-institucional-blue ml-1">
                      <Users className="w-4 h-4" /> Alumno
                    </label>
                    <select
                      value={selectedEnrollmentStudentId}
                      onChange={(e) => setSelectedEnrollmentStudentId(e.target.value)}
                      className="w-full bg-white border-2 border-institucional-blue/10 rounded-2xl p-4 shadow-sm focus:border-institucional-blue focus:ring-2 focus:ring-institucional-blue/20 outline-none transition-all appearance-none cursor-pointer"
                    >
                      <option value="">Seleccionar Alumno</option>
                      {students.map((student) => (
                        <option key={student.id_alumno} value={student.id_alumno}>
                          {student.nombre_alumno}
                        </option>
                      ))}
                    </select>
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

                {lastEnrollmentRecord && (
                  <div className="bg-white rounded-3xl p-4 shadow-xl border border-gray-100 text-xs text-gray-600 space-y-1">
                    <p className="text-[10px] uppercase tracking-wider text-gray-400 font-bold">Respuesta n8n tipada</p>
                    <p>ID alumno: {lastEnrollmentRecord.id_alumno}</p>
                    <p>Nombre: {lastEnrollmentRecord.nombre_alumno}</p>
                    <p>ID padre: {lastEnrollmentRecord.id_padre}</p>
                    <p>ID tutor: {lastEnrollmentRecord.id_tutor}</p>
                    <p>RekognitionId: {lastEnrollmentRecord.RekognitionId}</p>
                    <p>Registro: #{lastEnrollmentRecord.id}</p>
                  </div>
                )}
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
                  {(attendanceStatus === 'success' || attendanceStatus === 'error') && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className={`absolute inset-0 flex flex-col items-center justify-center z-20 backdrop-blur-sm ${
                        attendanceStatus === 'success' ? 'bg-green-600/30' : 'bg-red-600/30'
                      }`}
                    >
                      <motion.div
                        initial={{ scale: 0, rotate: -45 }}
                        animate={{ scale: 1, rotate: 0 }}
                        className="bg-white p-6 rounded-full shadow-2xl"
                      >
                        {attendanceStatus === 'success' ? (
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
                        {attendanceStatus === 'success' ? '¡ASISTENCIA REGISTRADA!' : 'ERROR DE REGISTRO'}
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
                    <p className="text-xs text-gray-500 mt-1">{attendanceMessage || 'La asistencia se guarda automáticamente en n8n.'}</p>
                  </div>
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
