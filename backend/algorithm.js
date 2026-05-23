/**
 * Helper para convertir un string de hora "HH:MM" a minutos transcurridos en el día
 * @param {string} timeStr - Hora en formato "HH:MM"
 * @returns {number} - Minutos desde la medianoche
 */
function parseTimeToMinutes(timeStr) {
  if (!timeStr) return 0;
  const [h, m] = timeStr.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/**
 * Algoritmo Avanzado de Auto-Asignación Multi-Negocio, Multi-Rol e Intervalos Horarios
 * 
 * Resuelve la planificación optimizada recorriendo:
 * Días -> Locales/Negocios -> Turnos Específicos del Local -> Roles Profesionales.
 * 
 * @param {object} dbData - Datos de configuración, demanda, empleados y cuadrante.
 * @returns {object} - Asignaciones optimizadas: { emp_id: { Lunes: 'b_1|Manana', ... } }
 */
export function autoAssign(dbData) {
  const { employees, demands, config } = dbData;
  const shiftsConfig = config.shifts || {};
  const businesses = config.businesses || [];
  const roles = config.roles || [];
  const days = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
  
  // 1. Inicializamos cuadrante de asignaciones vacío (en Descanso)
  const newAssignments = {};
  const weeklyHours = {}; // Control de horas de contrato consumidas
  
  employees.forEach(emp => {
    newAssignments[emp.id] = {};
    days.forEach(day => {
      newAssignments[emp.id][day] = 'Descanso';
    });
    weeklyHours[emp.id] = 0;
  });

  // Helper para obtener el día anterior
  const getPreviousDay = (day) => {
    const idx = days.indexOf(day);
    if (idx === 0) return 'Domingo';
    return days[idx - 1];
  };

  // --- RECORRIDO DE PLANIFICACIÓN ESTRATÉGICO ---
  days.forEach(day => {
    
    // Iteramos por Negocio
    businesses.forEach(business => {
      
      // Extraemos los turnos específicos configurados para este local
      const businessShifts = shiftsConfig[business.id] || {};
      
      // Ordenamos los turnos de mayor a menor complejidad/fatiga si es posible (ej. Noche primero)
      const shiftOrder = Object.keys(businessShifts).sort((a, b) => {
        if (a === 'Noche') return -1;
        if (b === 'Noche') return 1;
        if (a === 'Tarde' && b === 'Manana') return -1;
        return 1;
      });

      shiftOrder.forEach(shiftId => {
        const shiftInfo = businessShifts[shiftId];
        if (!shiftInfo) return;

        // Comprobación de si el turno está activo en este día de la semana
        let shiftActive = true;
        let shiftStart = shiftInfo.start;
        let shiftEnd = shiftInfo.end;
        let shiftHours = Number(shiftInfo.hours) || 8;

        if (shiftInfo.days && shiftInfo.days[day]) {
          shiftActive = shiftInfo.days[day].active;
          shiftStart = shiftInfo.days[day].start;
          shiftEnd = shiftInfo.days[day].end;
          shiftHours = Number(shiftInfo.days[day].hours) || 0;
        }

        if (!shiftActive) return; // Omitir el turno hoy si está inactivo

        // Convertir horario del turno a minutos
        let shiftStartMin = parseTimeToMinutes(shiftStart);
        let shiftEndMin = parseTimeToMinutes(shiftEnd);
        
        // Corrección de cruce de medianoche para el turno
        if (shiftEndMin <= shiftStartMin) {
          shiftEndMin += 1440;
        }

        // Dentro de cada negocio y turno, iteramos por cada Rol Profesional independiente
        roles.forEach(roleId => {
          
          // Obtenemos la cantidad demandada para esta combinación
          const roleDemand = demands[business.id]?.[day]?.[shiftId]?.[roleId] || 0;
          if (roleDemand <= 0) return; // Sin demanda

          let assignedCount = 0;

          // Intentamos cubrir la demanda para este rol
          while (assignedCount < roleDemand) {
            const candidates = [];

            employees.forEach(emp => {
              // --- FILTRO 1: Rol estricto ---
              if (emp.role !== roleId) return;

              // --- FILTRO 1.5: Asignación a local estricta ---
              if (emp.assignedBusinessId && emp.assignedBusinessId !== 'indiferente' && emp.assignedBusinessId !== '' && emp.assignedBusinessId !== business.id) {
                return;
              }

              // --- FILTRO 2: Indisponibilidad / Rango Horario ---
              const empAvail = emp.availability?.[day];
              if (!empAvail || empAvail.type === 'none') {
                return; // No disponible / Descanso completo
              }
              
              if (empAvail.type === 'partial') {
                // Validación matemática de intervalos horarios
                let availStartMin = parseTimeToMinutes(empAvail.start);
                let availEndMin = parseTimeToMinutes(empAvail.end);
                
                // Corrección cruce de medianoche en disponibilidad
                if (availEndMin <= availStartMin) {
                  availEndMin += 1440;
                }

                // El rango de horas del turno debe caber enteramente dentro de la ventana de disponibilidad
                const fits = (availStartMin <= shiftStartMin) && (shiftEndMin <= availEndMin);
                if (!fits) return; // Fuera del horario disponible
              }

              // --- FILTRO 3: Horas máximas del contrato semanal ---
              if (emp.maxHours !== 'Indefinido' && weeklyHours[emp.id] + shiftHours > emp.maxHours) return;

              // --- FILTRO 4: No estar asignado a más de 2 cosas o solaparse el mismo día ---
              const currentAssign = newAssignments[emp.id][day];
              if (currentAssign !== 'Descanso') {
                const parts = currentAssign.split(',');
                if (parts.length >= 2) return; // Ya tiene 2 turnos hoy!
                
                // Si ya tiene 1 turno, comprobar solapamiento con el nuevo turno
                const existingShift = parts[0];
                const [exBizId, exShiftId] = existingShift.split('|');
                const exShiftInfo = (shiftsConfig[exBizId] || {})[exShiftId];
                if (exShiftInfo) {
                  let exStart = exShiftInfo.start;
                  let exEnd = exShiftInfo.end;
                  if (exShiftInfo.days && exShiftInfo.days[day]) {
                    exStart = exShiftInfo.days[day].start;
                    exEnd = exShiftInfo.days[day].end;
                  }
                  let exStartMin = parseTimeToMinutes(exStart);
                  let exEndMin = parseTimeToMinutes(exEnd);
                  if (exEndMin <= exStartMin) exEndMin += 1440;
                  
                  const overlaps = Math.max(exStartMin, shiftStartMin) < Math.min(exEndMin, shiftEndMin);
                  if (overlaps) return; // Se solapan, no se puede asignar
                }
              }

              // --- FILTRO 5: Descanso Post-Nocturno ---
              const prevDay = getPreviousDay(day);
              const prevAssignment = newAssignments[emp.id][prevDay] || 'Descanso';
              // Verificamos si trabajó de noche (ej: "b_1|Noche" o "b_2|Noche")
              const workedNightYesterday = prevAssignment.includes('Noche');
              if (workedNightYesterday && (shiftId === 'Manana' || shiftId === 'Tarde')) {
                return;
              }

              // --- SISTEMA DE PUNTUACIÓN DE CANDIDATOS ---
              let score = 0;

              // A) Preferencia Horaria
              if (emp.preferredShift === shiftId) {
                score += 15;
              } else if (emp.preferredShift === 'MananaYNoche' && (shiftId === 'Manana' || shiftId === 'Noche')) {
                score += 15;
              } else if (emp.preferredShift === 'Indiferente') {
                score += 8;
              }

              // B) Equidad y Carga Laboral
              const maxH = emp.maxHours === 'Indefinido' ? 168 : emp.maxHours;
              const unusedHoursRatio = (maxH - weeklyHours[emp.id]) / maxH;
              score += unusedHoursRatio * 30;

              // C) Penalización por fatiga de Noche consecutiva
              if (shiftId === 'Noche' && prevAssignment.includes('Noche')) {
                score -= 10;
              }

              candidates.push({ empId: emp.id, score });
            });

            // Si no quedan candidatos para cubrir este rol hoy, rompemos la búsqueda
            if (candidates.length === 0) {
              break;
            }

            // Ordenamos candidatos por mayor idoneidad
            candidates.sort((a, b) => b.score - a.score);

            // Asignamos el mejor candidato al Negocio y Turno correspondientes (acumulando dobles asignaciones)
            const winner = candidates[0];
            const currentVal = newAssignments[winner.empId][day];
            if (currentVal === 'Descanso') {
              newAssignments[winner.empId][day] = `${business.id}|${shiftId}`;
            } else {
              newAssignments[winner.empId][day] = `${currentVal},${business.id}|${shiftId}`;
            }
            weeklyHours[winner.empId] += shiftHours;
            assignedCount++;
          }

        });
      });
    });
  });

  return newAssignments;
}
