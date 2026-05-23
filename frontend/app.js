const { createApp } = Vue;

// Helper para convertir hora HH:MM a minutos
function timeToMinutes(str) {
  if (!str) return 0;
  const [h, m] = str.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

createApp({
  data() {
    return {
      authBoot: {
        hasAdminUsers: false,
        demoLicenseKey: ''
      },
      authMode: 'login',
      authRole: 'admin',
      authSession: {
        token: '',
        role: '',
        user: null
      },
      authForm: {
        login: {
          email: '',
          password: ''
        },
        adminRegister: {
          name: '',
          companyName: '',
          email: '',
          password: '',
          licenseKey: ''
        },
        employeeRegister: {
          name: '',
          email: '',
          password: '',
          registrationCode: ''
        }
      },

      // Identidad de la Empresa
      config: {
        venueName: 'Grupo Gastronómico Shiftly',
        roles: ['Camarero', 'Cocina', 'Encargado'],
        businesses: [],
        shifts: {} // Se cargará por negocio: { b_1: { Manana: {...}, ... } }
      },
      
      // Demanda Tridimensional: [businessId][day][shiftId][roleId] = numero
      demands: {},
      
      // Empleados y Preferencias
      employees: [],
      // Cuadrante: [employeeId][day] = 'businessId|shiftId' o 'Descanso'
      assignments: {},
      
      // Control de Estado del UI
      activeTab: 'cuadrante', // 'cuadrante' | 'empleados' | 'ajustes'
      darkMode: true,
      portalMode: 'admin', // 'admin' | 'empleado'
      saving: false,
      activePopover: null, // { empId: '...', day: '...' } para controlar qué celda tiene desplegado el popover
      
      // Selectores activos en la configuración
      activeDemandBusinessId: '', // Local seleccionado para configurar su demanda/turnos
      activeSummaryBusinessId: '', // Local seleccionado para ver su demanda en el cuadrante

      // Feedback Toasts
      toast: {
        show: false,
        message: '',
        type: 'success'
      },

      // Formulario de Empleados
      showEmployeeForm: false,
      editingEmployee: null,
      employeeForm: {
        name: '',
        role: 'Camarero',
        maxHours: 40,
        preferredShift: 'Indiferente',
        assignedBusinessId: '',
        availability: {
          Lunes: { type: 'full', start: '08:00', end: '16:00' },
          Martes: { type: 'full', start: '08:00', end: '16:00' },
          Miércoles: { type: 'full', start: '08:00', end: '16:00' },
          Jueves: { type: 'full', start: '08:00', end: '16:00' },
          Viernes: { type: 'full', start: '08:00', end: '16:00' },
          Sábado: { type: 'full', start: '08:00', end: '16:00' },
          Domingo: { type: 'full', start: '08:00', end: '16:00' }
        }
      },

      // Administración rápida de Negocios y Roles
      newBusinessName: '',
      newRoleName: '',
      newShiftForm: {
        id: '',
        name: '',
        start: '08:00',
        end: '16:00',
        hours: 8,
        color: 'sky'
      },

      registrationCodes: [],
      registrationCodeForm: {
        role: 'Camarero',
        assignedBusinessId: '',
        maxHours: 40,
        preferredShift: 'Indiferente',
        note: ''
      },

      // Portal Móvil del Empleado
      selectedEmployeeId: '',
      isEmployeeLoggedIn: false,
      employeePrefForm: {
        preferredShift: 'Indiferente',
        availability: {
          Lunes: { type: 'full', start: '08:00', end: '16:00' },
          Martes: { type: 'full', start: '08:00', end: '16:00' },
          Miércoles: { type: 'full', start: '08:00', end: '16:00' },
          Jueves: { type: 'full', start: '08:00', end: '16:00' },
          Viernes: { type: 'full', start: '08:00', end: '16:00' },
          Sábado: { type: 'full', start: '08:00', end: '16:00' },
          Domingo: { type: 'full', start: '08:00', end: '16:00' }
        }
      }
    };
  },

  computed: {
    days() {
      return ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
    },

    isAuthenticated() {
      return Boolean(this.authSession.token);
    },

    isAdmin() {
      return this.authSession.role === 'admin';
    },

    isEmployeePortal() {
      return this.authSession.role === 'employee';
    },

    activeConfigShifts() {
      const bizId = this.activeDemandBusinessId;
      if (!bizId || !this.config.shifts[bizId]) return [];
      return Object.keys(this.config.shifts[bizId]);
    },

    activeSummaryShifts() {
      const bizId = this.activeSummaryBusinessId;
      if (!bizId || !this.config.shifts[bizId]) return [];
      return Object.keys(this.config.shifts[bizId]);
    },

    employeeAccessCodes() {
      return [...this.employees]
        .filter(employee => employee.accessCode)
        .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    },

    loggedEmployee() {
      if (this.isEmployeePortal && this.authSession.user?.employeeId) {
        return this.employees.find(e => e.id === this.authSession.user.employeeId) || null;
      }
      if (!this.selectedEmployeeId) return null;
      return this.employees.find(e => e.id === this.selectedEmployeeId) || null;
    },

    // Genera la agenda semanal del empleado con nombres de locales y horarios (soportando dobles turnos)
    loggedEmployeeShifts() {
      if (!this.selectedEmployeeId || !this.assignments) return [];
      const empId = this.selectedEmployeeId;
      const empAssignments = this.assignments[empId] || {};
      
      return this.days.map(day => {
        const val = empAssignments[day] || 'Descanso';
        if (val === 'Descanso') {
          return {
            day,
            isOff: true,
            name: 'Descanso',
            businessName: '',
            hoursText: 'Día Libre',
            duration: 0,
            color: 'slate'
          };
        }

        const parts = val.split(',');
        if (parts.length === 1) {
          const [bId, sId] = parts[0].split('|');
          const biz = this.config.businesses.find(b => b.id === bId);
          const shifts = this.config.shifts[bId] || {};
          const shiftDetail = shifts[sId];

          let hoursText = 'Horario';
          let duration = 8;
          if (shiftDetail) {
            if (shiftDetail.days && shiftDetail.days[day]) {
              hoursText = `${shiftDetail.days[day].start} - ${shiftDetail.days[day].end}`;
              duration = Number(shiftDetail.days[day].hours) || 0;
            } else {
              hoursText = `${shiftDetail.start} - ${shiftDetail.end}`;
              duration = Number(shiftDetail.hours) || 8;
            }
          }

          return {
            day,
            isOff: false,
            name: shiftDetail?.name || sId,
            businessName: biz ? biz.name : 'Local comercial',
            hoursText,
            duration,
            color: shiftDetail?.color || 'indigo'
          };
        } else {
          // Doble turno asignado hoy!
          const names = [];
          const bizNames = [];
          const hoursTexts = [];
          let totalDuration = 0;
          
          parts.forEach(p => {
            const [bId, sId] = p.split('|');
            const biz = this.config.businesses.find(b => b.id === bId);
            const shifts = this.config.shifts[bId] || {};
            const shiftDetail = shifts[sId];
            
            if (shiftDetail) {
              names.push(shiftDetail.name);
              bizNames.push(biz ? biz.name : 'Local');
              if (shiftDetail.days && shiftDetail.days[day]) {
                hoursTexts.push(`${shiftDetail.days[day].start}-${shiftDetail.days[day].end}`);
                totalDuration += Number(shiftDetail.days[day].hours) || 0;
              } else {
                hoursTexts.push(`${shiftDetail.start}-${shiftDetail.end}`);
                totalDuration += Number(shiftDetail.hours) || 8;
              }
            }
          });
          
          return {
            day,
            isOff: false,
            name: names.join(' + '),
            businessName: bizNames.join(' / '),
            hoursText: hoursTexts.join(', '),
            duration: totalDuration,
            color: 'purple' // Morado corporativo premium para doble asignación
          };
        }
      });
    },

    // Resumen de demanda tridimensional en vivo: [businessId][day][shiftId][roleId] = { assigned, demanded, state }
    demandSummary() {
      const summary = {};
      const businesses = this.config.businesses || [];
      const roles = this.config.roles || [];
      
      businesses.forEach(biz => {
        summary[biz.id] = {};
        
        this.days.forEach(day => {
          summary[biz.id][day] = {};
          
          const bizShifts = Object.keys(this.config.shifts[biz.id] || {});
          bizShifts.forEach(shiftId => {
            summary[biz.id][day][shiftId] = {};
            
            roles.forEach(roleId => {
              const demanded = this.demands[biz.id]?.[day]?.[shiftId]?.[roleId] || 0;
              let assigned = 0;

              // Contamos empleados del rol correspondiente asignados a este negocio y turno hoy (soportando dobles turnos)
              Object.keys(this.assignments).forEach(empId => {
                const emp = this.employees.find(e => e.id === empId);
                if (emp && emp.role === roleId) {
                  const assignValue = this.assignments[empId]?.[day];
                  if (assignValue && assignValue !== 'Descanso') {
                    if (assignValue.split(',').includes(`${biz.id}|${shiftId}`)) {
                      assigned++;
                    }
                  }
                }
              });

              let state = 'ok';
              if (assigned < demanded) state = 'under';
              else if (assigned > demanded) state = 'over';

              summary[biz.id][day][shiftId][roleId] = {
                assigned,
                demanded,
                state
              };
            });
          });
        });
      });

      return summary;
    }
  },

  watch: {
    darkMode(val) {
      this.applyTheme();
    },
    'newShiftForm.start'() {
      this.calculateNewShiftHours();
    },
    'newShiftForm.end'() {
      this.calculateNewShiftHours();
    }
  },

  mounted() {
    this.init();
    document.addEventListener('click', (e) => {
      if (this.activePopover && !e.target.closest('.relative.group')) {
        this.activePopover = null;
      }
    });
  },

  methods: {
    async init() {
      const localTheme = localStorage.getItem('shiftly_theme');
      this.darkMode = localTheme !== null ? localTheme === 'dark' : true;
      this.applyTheme();
      await this.fetchAuthBootstrap();
      await this.restoreSession();
    },

    createDefaultAvailability() {
      const availability = {};
      this.days.forEach(day => {
        availability[day] = { type: 'full', start: '08:00', end: '16:00' };
      });
      return availability;
    },

    authHeaders() {
      return this.authSession.token
        ? { Authorization: `Bearer ${this.authSession.token}` }
        : {};
    },

    async apiFetch(url, options = {}) {
      const headers = {
        ...(options.headers || {}),
        ...this.authHeaders()
      };

      const response = await fetch(url, {
        ...options,
        headers
      });

      if (response.status === 401) {
        this.clearSession(false);
        this.showToast('Tu sesión ha caducado. Vuelve a iniciar sesión.', 'warning');
      }

      return response;
    },

    persistSession() {
      localStorage.setItem('shiftly_session', JSON.stringify(this.authSession));
    },

    clearSession(notify = true) {
      localStorage.removeItem('shiftly_session');
      this.authSession = { token: '', role: '', user: null };
      this.portalMode = 'admin';
      this.isEmployeeLoggedIn = false;
      this.selectedEmployeeId = '';
      this.registrationCodes = [];
      this.employees = [];
      this.assignments = {};
      if (notify) {
        this.showToast('Sesión cerrada correctamente');
      }
    },

    async fetchAuthBootstrap() {
      try {
        const res = await fetch('/api/auth/bootstrap');
        if (!res.ok) throw new Error();
        this.authBoot = await res.json();
        if (!this.authBoot.hasAdminUsers && !this.authForm.adminRegister.licenseKey) {
          this.authForm.adminRegister.licenseKey = this.authBoot.demoLicenseKey || '';
        }
      } catch (error) {
        this.showToast('No se pudo preparar la pantalla de acceso', 'error');
      }
    },

    async restoreSession() {
      const rawSession = localStorage.getItem('shiftly_session');
      if (!rawSession) return;

      try {
        this.authSession = JSON.parse(rawSession);
        const res = await this.apiFetch('/api/auth/me');
        if (!res.ok) throw new Error();
        const session = await res.json();
        this.authSession.role = session.role;
        this.authSession.user = session.user;
        this.persistSession();
        await this.hydrateSession();
      } catch (error) {
        this.clearSession(false);
      }
    },

    async hydrateSession() {
      this.portalMode = this.isAdmin ? 'admin' : 'empleado';

      if (this.isAdmin) {
        await this.fetchConfig();
        await this.fetchEmployees();
        await this.fetchAssignments();
        await this.fetchRegistrationCodes();
        return;
      }

      await this.fetchEmployeePortal();
    },

    applyTheme() {
      if (this.darkMode) {
        document.documentElement.classList.add('dark');
        localStorage.setItem('shiftly_theme', 'dark');
      } else {
        document.documentElement.classList.remove('dark');
        localStorage.setItem('shiftly_theme', 'light');
      }
    },

    showToast(message, type = 'success') {
      this.toast.message = message;
      this.toast.type = type;
      this.toast.show = true;
      setTimeout(() => {
        this.toast.show = false;
      }, 4000);
    },

    async submitAuth() {
      const role = this.authRole;
      const isLogin = this.authMode === 'login';
      const endpoint = isLogin
        ? '/api/auth/login'
        : role === 'admin'
          ? '/api/auth/register-admin'
          : '/api/auth/register-employee';

      const payload = isLogin
        ? {
            email: this.authForm.login.email,
            password: this.authForm.login.password,
            role
          }
        : role === 'admin'
          ? this.authForm.adminRegister
          : this.authForm.employeeRegister;

      this.saving = true;
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || 'No se pudo completar la operación');
        }

        if (!isLogin) {
          this.showToast(role === 'admin' ? 'Administrador registrado. Ya puedes iniciar sesión.' : 'Empleado registrado. Ya puedes acceder.');
          this.authMode = 'login';
          this.authForm.login.email = payload.email;
          return;
        }

        this.authSession = {
          token: data.token,
          role: data.role,
          user: data.user
        };
        this.persistSession();
        await this.hydrateSession();
        this.isEmployeeLoggedIn = this.isEmployeePortal;
        this.showToast(this.isAdmin ? 'Sesión de administrador iniciada' : 'Sesión de empleado iniciada');
      } catch (error) {
        this.showToast(error.message, 'error');
      } finally {
        this.saving = false;
      }
    },

    async logout() {
      try {
        await this.apiFetch('/api/auth/logout', { method: 'POST' });
      } catch (error) {
        // Ignoramos fallos de red al cerrar una sesión local.
      }
      this.clearSession();
    },

    // API: Obtener configuración
    async fetchConfig() {
      try {
        const res = await this.apiFetch('/api/config');
        if (!res.ok) throw new Error();
        const data = await res.json();
        this.config = data.config;
        this.demands = data.demands || {};
        
        if (!this.config.shifts) this.config.shifts = {};

        // Estabilizar lista de negocios y demandas vacías si es necesario
        if (this.config.businesses && this.config.businesses.length > 0) {
          this.activeDemandBusinessId = this.config.businesses[0].id;
          this.activeSummaryBusinessId = this.config.businesses[0].id;
          
          // Asegurar que existan las llaves de demanda y turnos para cada negocio
          this.config.businesses.forEach(b => {
            // Estabilizar turnos por negocio
            if (!this.config.shifts[b.id]) {
              this.config.shifts[b.id] = {
                Manana: { id: 'Manana', name: 'Mañana', start: '08:00', end: '16:00', hours: 8, color: 'amber' },
                Tarde: { id: 'Tarde', name: 'Tarde', start: '16:00', end: '00:00', hours: 8, color: 'orange' },
                Noche: { id: 'Noche', name: 'Noche', start: '00:00', end: '08:00', hours: 8, color: 'indigo' }
              };
            }

            // Estabilizar horarios por día (days) en cada turno
            Object.keys(this.config.shifts[b.id]).forEach(shiftId => {
              const shift = this.config.shifts[b.id][shiftId];
              if (!shift.days) {
                shift.days = {};
              }
              this.days.forEach(day => {
                if (!shift.days[day]) {
                  shift.days[day] = {
                    active: true,
                    start: shift.start || '08:00',
                    end: shift.end || '16:00',
                    hours: Number(shift.hours) || 8
                  };
                }
              });
            });

            if (!this.demands[b.id]) {
              this.demands[b.id] = {};
            }
            
            this.days.forEach(day => {
              if (!this.demands[b.id][day]) {
                this.demands[b.id][day] = {};
              }
              const bizShifts = Object.keys(this.config.shifts[b.id] || {});
              bizShifts.forEach(s => {
                if (!this.demands[b.id][day][s]) {
                  this.demands[b.id][day][s] = {};
                }
                this.config.roles.forEach(r => {
                  if (this.demands[b.id][day][s][r] === undefined) {
                    this.demands[b.id][day][s][r] = 0;
                  }
                });
              });
            });
          });
        }
      } catch (err) {
        this.showToast('Error al cargar ajustes del backend', 'error');
      }
    },

    // API: Cargar Empleados
    async fetchEmployees() {
      try {
        const res = await this.apiFetch('/api/employees');
        if (!res.ok) throw new Error();
        this.employees = await res.json();
        
        // Inicializar asignaciones vacías de seguridad para evitar crasheos de reactividad en Vue
        this.employees.forEach(emp => {
          if (!this.assignments[emp.id]) {
            this.assignments[emp.id] = {
              Lunes: 'Descanso', Martes: 'Descanso', Miércoles: 'Descanso',
              Jueves: 'Descanso', Viernes: 'Descanso', Sábado: 'Descanso', Domingo: 'Descanso'
            };
          }
        });
      } catch (err) {
        console.error('Error al cargar empleados:', err);
      }
    },

    // API: Cargar Cuadrante
    async fetchAssignments() {
      try {
        const res = await this.apiFetch('/api/assignments');
        if (!res.ok) throw new Error();
        const data = await res.json();
        
        // Asegurar que cada empleado cargado tenga un objeto de asignación mapeado
        this.employees.forEach(emp => {
          if (!data[emp.id]) {
            data[emp.id] = {
              Lunes: 'Descanso', Martes: 'Descanso', Miércoles: 'Descanso',
              Jueves: 'Descanso', Viernes: 'Descanso', Sábado: 'Descanso', Domingo: 'Descanso'
            };
          }
        });
        this.assignments = data;
      } catch (err) {
        console.error('Error al cargar asignaciones:', err);
      }
    },

    // API: Guardar Ajustes Generales
    async saveConfig() {
      this.saving = true;
      try {
        const res = await this.apiFetch('/api/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            config: this.config,
            demands: this.demands
          })
        });
        if (!res.ok) throw new Error();
        const data = await res.json();
        this.config = data.config;
        this.demands = data.demands;
        this.showToast('Configuraciones de locales, turnos específicos y demandas guardadas');
      } catch (err) {
        this.showToast('Error al guardar ajustes en el servidor', 'error');
      } finally {
        this.saving = false;
      }
    },

    // Abre el formulario para Crear Empleado con disponibilidad limpia
    openCreateEmployee() {
      this.editingEmployee = null;

      this.employeeForm = {
        name: '',
        role: this.config.roles[0] || 'Camarero',
        maxHours: 40,
        preferredShift: 'Indiferente',
        assignedBusinessId: '',
        availability: this.createDefaultAvailability()
      };
      this.showEmployeeForm = true;
    },

    // Abre formulario de edición copiando disponibilidad y aplicando compatibilidad
    openEditEmployee(employee) {
      this.editingEmployee = employee;
      
      // Compatibilidad con perfiles antiguos
      const availability = {};
      this.days.forEach(day => {
        if (employee.availability && employee.availability[day]) {
          availability[day] = { ...employee.availability[day] };
        } else if (employee.unavailableDays && employee.unavailableDays.includes(day)) {
          availability[day] = { type: 'none', start: '08:00', end: '16:00' };
        } else {
          availability[day] = { type: 'full', start: '08:00', end: '16:00' };
        }
      });

      this.employeeForm = {
        name: employee.name,
        role: employee.role || 'Camarero',
        maxHours: employee.maxHours,
        preferredShift: employee.preferredShift || 'Indiferente',
        assignedBusinessId: employee.assignedBusinessId || '',
        availability
      };
      this.showEmployeeForm = true;
    },

    toggleUnlimitedHours(e) {
      if (e.target.checked) {
        this.employeeForm.maxHours = 'Indefinido';
      } else {
        this.employeeForm.maxHours = 40;
      }
    },

    // API: CRUD de Empleados - Guardar
    async saveEmployee() {
      if (!this.employeeForm.name.trim()) {
        this.showToast('El nombre es obligatorio', 'warning');
        return;
      }

      this.saving = true;
      try {
        let res;
        let savedEmployee = null;
        if (this.editingEmployee) {
          res = await this.apiFetch(`/api/employees/${this.editingEmployee.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(this.employeeForm)
          });
        } else {
          res = await this.apiFetch('/api/employees', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(this.employeeForm)
          });
        }

        if (!res.ok) throw new Error();
        savedEmployee = await res.json();
        await this.fetchEmployees();
        await this.fetchAssignments();
        
        this.showToast(
          this.editingEmployee
            ? 'Empleado actualizado'
            : `Empleado añadido. Código de acceso inicial: ${savedEmployee.accessCode}`,
          'success'
        );
        this.showEmployeeForm = false;
      } catch (err) {
        this.showToast('Error al guardar empleado', 'error');
      } finally {
        this.saving = false;
      }
    },

    async regenerateEmployeeCode(employee) {
      this.saving = true;
      try {
        const res = await this.apiFetch(`/api/employees/${employee.id}/access-code`, {
          method: 'POST'
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'No se pudo regenerar el código');

        await this.fetchEmployees();
        this.showToast(`Nuevo código para ${data.employee.name}: ${data.employee.accessCode}`, 'success');
      } catch (error) {
        this.showToast(error.message, 'error');
      } finally {
        this.saving = false;
      }
    },

    // API: CRUD de Empleados - Eliminar
    async deleteEmployee(id) {
      if (!confirm('¿Deseas eliminar este empleado? Se perderán sus turnos asignados.')) {
        return;
      }
      try {
        const res = await this.apiFetch(`/api/employees/${id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error();
        await this.fetchEmployees();
        await this.fetchAssignments();
        this.showToast('Empleado eliminado de la plantilla');
      } catch (err) {
        this.showToast('Error al eliminar empleado', 'error');
      }
    },

    // CRUD de Negocios (Guardado Inmediato)
    async addBusiness() {
      if (!this.newBusinessName.trim()) return;
      const newId = 'b_' + Math.random().toString(36).substr(2, 9);
      
      this.config.businesses.push({
        id: newId,
        name: this.newBusinessName
      });
      
      // Inicializar turnos base independientes para el nuevo negocio
      if (!this.config.shifts) this.config.shifts = {};
      this.config.shifts[newId] = {
        Manana: { id: 'Manana', name: 'Mañana', start: '08:00', end: '16:00', hours: 8, color: 'amber' },
        Tarde: { id: 'Tarde', name: 'Tarde', start: '16:00', end: '00:00', hours: 8, color: 'orange' },
        Noche: { id: 'Noche', name: 'Noche', start: '00:00', end: '08:00', hours: 8, color: 'indigo' }
      };

      // Inicializar demandas para el nuevo local
      this.demands[newId] = {};
      this.days.forEach(day => {
        this.demands[newId][day] = {};
        Object.keys(this.config.shifts[newId]).forEach(s => {
          this.demands[newId][day][s] = {};
          this.config.roles.forEach(r => {
            this.demands[newId][day][s][r] = 0;
          });
        });
      });

      this.newBusinessName = '';
      await this.saveConfig();
      this.activeDemandBusinessId = newId;
      this.activeSummaryBusinessId = newId;
      this.showToast('Nuevo local comercial registrado y guardado con éxito');
    },

    async deleteBusiness(id) {
      if (this.config.businesses.length <= 1) {
        this.showToast('Debe haber al menos un local registrado', 'warning');
        return;
      }
      if (confirm('¿Eliminar este local comercial? Se perderán sus turnos y demandas específicas.')) {
        this.config.businesses = this.config.businesses.filter(b => b.id !== id);
        if (this.demands[id]) delete this.demands[id];
        if (this.config.shifts[id]) delete this.config.shifts[id];
        
        // Limpiar asignaciones
        Object.keys(this.assignments).forEach(empId => {
          this.days.forEach(day => {
            if (this.assignments[empId][day] && this.assignments[empId][day].startsWith(id)) {
              this.assignments[empId][day] = 'Descanso';
            }
          });
        });

        await this.saveConfig();
        if (this.activeDemandBusinessId === id && this.config.businesses.length > 0) {
          this.activeDemandBusinessId = this.config.businesses[0].id;
        }
        if (this.activeSummaryBusinessId === id && this.config.businesses.length > 0) {
          this.activeSummaryBusinessId = this.config.businesses[0].id;
        }
        this.showToast('Local comercial eliminado con éxito');
      }
    },

    // CRUD de Roles (Guardado Inmediato)
    async addRole() {
      const name = this.newRoleName.trim();
      if (!name) return;
      if (this.config.roles.includes(name)) {
        this.showToast('El rol ya está registrado', 'warning');
        return;
      }
      
      this.config.roles.push(name);
      this.newRoleName = '';
      
      // Estabilizar la matriz de demandas para todos los locales con el nuevo rol
      this.config.businesses.forEach(b => {
        if (!this.demands[b.id]) this.demands[b.id] = {};
        this.days.forEach(day => {
          if (!this.demands[b.id][day]) this.demands[b.id][day] = {};
          const bizShifts = Object.keys(this.config.shifts[b.id] || {});
          bizShifts.forEach(s => {
            if (!this.demands[b.id][day][s]) this.demands[b.id][day][s] = {};
            if (this.demands[b.id][day][s][name] === undefined) {
              this.demands[b.id][day][s][name] = 0;
            }
          });
        });
      });

      await this.saveConfig();
      this.showToast(`Nuevo rol profesional "${name}" añadido y guardado`);
    },

    async deleteRole(name) {
      if (this.config.roles.length <= 1) {
        this.showToast('Debe haber al menos un rol profesional', 'warning');
        return;
      }
      if (confirm(`¿Eliminar el rol "${name}"? Se limpiarán las demandas vinculadas.`)) {
        this.config.roles = this.config.roles.filter(r => r !== name);
        
        // Limpiar demandas asociadas a este rol
        this.config.businesses.forEach(b => {
          this.days.forEach(day => {
            const bizShifts = Object.keys(this.config.shifts[b.id] || {});
            bizShifts.forEach(s => {
              if (this.demands[b.id]?.[day]?.[s]?.[name] !== undefined) {
                delete this.demands[b.id][day][s][name];
              }
            });
          });
        });

        await this.saveConfig();
        this.showToast(`Rol profesional "${name}" eliminado de la plantilla`);
      }
    },

    calculateNewShiftHours() {
      const start = this.newShiftForm.start;
      const end = this.newShiftForm.end;
      if (!start || !end || !start.includes(':') || !end.includes(':')) return;

      let s = timeToMinutes(start);
      let e = timeToMinutes(end);
      if (isNaN(s) || isNaN(e)) return;

      if (e <= s) e += 1440; // Medianoche

      const diff = e - s;
      this.newShiftForm.hours = Math.round((diff / 60) * 10) / 10;
    },

    recalculateShiftHours(shift) {
      if (!shift || !shift.start || !shift.end) return;
      if (!shift.start.includes(':') || !shift.end.includes(':')) return;

      let s = timeToMinutes(shift.start);
      let e = timeToMinutes(shift.end);
      if (isNaN(s) || isNaN(e)) return;

      if (e <= s) e += 1440; // Medianoche

      const diff = e - s;
      shift.hours = Math.round((diff / 60) * 10) / 10;
    },

    recalculateDayShiftHours(shift, day) {
      if (!shift || !shift.days || !shift.days[day]) return;
      const dConf = shift.days[day];
      if (!dConf.start || !dConf.end || !dConf.start.includes(':') || !dConf.end.includes(':')) return;

      let s = timeToMinutes(dConf.start);
      let e = timeToMinutes(dConf.end);
      if (isNaN(s) || isNaN(e)) return;

      if (e <= s) e += 1440; // Medianoche

      const diff = e - s;
      dConf.hours = Math.round((diff / 60) * 10) / 10;
      
      // Auto-guardar inmediatamente al cambiar horas
      this.saveConfig();
    },

    // Lógica dinámica de Turnos por Negocio (Guardado Inmediato)
    async addShift() {
      const bizId = this.activeDemandBusinessId;
      if (!bizId) return;

      const id = this.newShiftForm.id.trim();
      const name = this.newShiftForm.name.trim();
      const start = this.newShiftForm.start.trim();
      const end = this.newShiftForm.end.trim();
      const hours = Number(this.newShiftForm.hours) || 8;
      const color = this.newShiftForm.color;

      if (!id || !name || !start || !end) {
        this.showToast('Todos los campos del turno son obligatorios', 'warning');
        return;
      }

      if (!this.config.shifts[bizId]) {
        this.config.shifts[bizId] = {};
      }

      if (this.config.shifts[bizId][id]) {
        this.showToast('Ya existe un turno con este identificador', 'warning');
        return;
      }

      // Inicializar el objeto de horarios por día (days)
      const daysObj = {};
      this.days.forEach(day => {
        daysObj[day] = {
          active: true,
          start: start,
          end: end,
          hours: hours
        };
      });

      this.config.shifts[bizId][id] = {
        id,
        name,
        start,
        end,
        hours,
        color,
        days: daysObj
      };

      // Inicializar la matriz de demanda para este nuevo turno
      this.days.forEach(day => {
        if (!this.demands[bizId][day]) this.demands[bizId][day] = {};
        if (!this.demands[bizId][day][id]) this.demands[bizId][day][id] = {};
        this.config.roles.forEach(role => {
          this.demands[bizId][day][id][role] = 0;
        });
      });

      // Limpiar formulario
      this.newShiftForm = {
        id: '',
        name: '',
        start: '08:00',
        end: '16:00',
        hours: 8,
        color: 'sky'
      };

      await this.saveConfig();
      this.showToast(`Turno "${name}" registrado y guardado con éxito`);
    },

    async deleteShift(shiftId) {
      const bizId = this.activeDemandBusinessId;
      if (!bizId) return;

      const shifts = this.config.shifts[bizId];
      if (!shifts || Object.keys(shifts).length <= 1) {
        this.showToast('Debe haber al menos un turno registrado para el negocio', 'warning');
        return;
      }

      const shiftName = shifts[shiftId]?.name || shiftId;
      if (!confirm(`¿Eliminar el turno "${shiftName}"? Se perderán las demandas y asignaciones correspondientes.`)) {
        return;
      }

      delete this.config.shifts[bizId][shiftId];

      // Limpiar demandas asociadas
      this.days.forEach(day => {
        if (this.demands[bizId]?.[day]?.[shiftId]) {
          delete this.demands[bizId][day][shiftId];
        }
      });

      // Limpiar asignaciones
      Object.keys(this.assignments).forEach(empId => {
        this.days.forEach(day => {
          if (this.assignments[empId][day] === `${bizId}|${shiftId}`) {
            this.assignments[empId][day] = 'Descanso';
          }
        });
      });

      await this.saveConfig();
      this.showToast(`Turno "${shiftName}" eliminado con éxito`);
    },

    // API: Guardar cuadrante manual
    async saveAssignments() {
      this.saving = true;
      try {
        const res = await this.apiFetch('/api/assignments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ assignments: this.assignments })
        });
        if (!res.ok) throw new Error();
        this.showToast('Asignaciones del cuadrante guardadas');
      } catch (err) {
        this.showToast('Error al guardar el cuadrante', 'error');
      } finally {
        this.saving = false;
      }
    },

    // API: Auto-Asignación Inteligente
    async autoAssign() {
      this.saving = true;
      try {
        const res = await this.apiFetch('/api/assignments/auto', { method: 'POST' });
        if (!res.ok) throw new Error();
        const data = await res.json();
        this.assignments = data.assignments;
        this.showToast('¡Auto-Asignación completada basándose en los turnos específicos de cada negocio!');
      } catch (err) {
        this.showToast('Error al ejecutar el algoritmo de cuadrantes', 'error');
      } finally {
        this.saving = false;
      }
    },

    async clearAssignments() {
      if (!confirm('¿Restablecer todo el cuadrante de la semana?')) return;
      const cleared = {};
      this.employees.forEach(emp => {
        cleared[emp.id] = {};
        this.days.forEach(day => {
          cleared[emp.id][day] = 'Descanso';
        });
      });
      this.assignments = cleared;
      await this.saveAssignments();
      this.showToast('Cuadrante restablecido');
    },

    async fetchRegistrationCodes() {
      try {
        const res = await this.apiFetch('/api/registration-codes');
        if (!res.ok) throw new Error();
        this.registrationCodes = await res.json();
      } catch (error) {
        this.showToast('No se pudieron cargar los códigos de registro', 'error');
      }
    },

    async createRegistrationCode() {
      this.saving = true;
      try {
        const res = await this.apiFetch('/api/registration-codes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(this.registrationCodeForm)
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'No se pudo generar el código');
        this.registrationCodes.unshift(data);
        this.registrationCodeForm.note = '';
        this.showToast(`Código ${data.code} generado para empleados`);
      } catch (error) {
        this.showToast(error.message, 'error');
      } finally {
        this.saving = false;
      }
    },

    async fetchEmployeePortal() {
      try {
        const res = await this.apiFetch('/api/employee/portal');
        if (!res.ok) throw new Error();
        const data = await res.json();
        this.config = {
          ...this.config,
          ...data.config
        };
        this.employees = [data.employee];
        this.assignments = {
          [data.employee.id]: data.assignments
        };
        this.selectedEmployeeId = data.employee.id;
        this.isEmployeeLoggedIn = true;
        this.employeePrefForm.preferredShift = data.employee.preferredShift || 'Indiferente';
        this.employeePrefForm.availability = data.employee.availability || this.createDefaultAvailability();
      } catch (error) {
        this.showToast('No se pudo cargar el portal del empleado', 'error');
      }
    },

    // --- LÓGICA DE VALIDACIÓN ---

    calculateWeeklyHours(employeeId) {
      if (!this.assignments[employeeId]) return 0;
      let total = 0;
      const empAssignments = this.assignments[employeeId];
      this.days.forEach(day => {
        const val = empAssignments[day];
        if (val && val !== 'Descanso') {
          val.split(',').forEach(assignment => {
            const [bId, sId] = assignment.split('|');
            const shifts = this.config.shifts[bId] || {};
            const shiftDetail = shifts[sId];
            if (shiftDetail) {
              if (shiftDetail.days && shiftDetail.days[day]) {
                total += Number(shiftDetail.days[day].hours) || 0;
              } else {
                total += Number(shiftDetail.hours) || 0;
              }
            }
          });
        }
      });
      return total;
    },

    // Valida si la celda viola la disponibilidad horaria del empleado
    isCellViolated(employee, day, assignValue) {
      if (assignValue === 'Descanso' || !assignValue) return false;
      
      const parts = assignValue.split(',');

      // 1. Verificar local asignado estricto
      for (let p of parts) {
        const [bizId, shiftId] = p.split('|');
        if (employee.assignedBusinessId && employee.assignedBusinessId !== 'indiferente' && employee.assignedBusinessId !== '' && employee.assignedBusinessId !== bizId) {
          return true;
        }
      }
      
      // 2. Verificar inactividad de turnos hoy
      for (let p of parts) {
        const [bizId, shiftId] = p.split('|');
        const shifts = this.config.shifts[bizId] || {};
        const shiftDetail = shifts[shiftId];
        if (!shiftDetail) return false;
        if (shiftDetail.days && shiftDetail.days[day] && !shiftDetail.days[day].active) {
          return true;
        }
      }

      const empAvail = employee.availability?.[day] || 
                       (employee.unavailableDays && employee.unavailableDays.includes(day) ? { type: 'none' } : { type: 'full' });

      // 3. Descanso / No disponible completo
      if (empAvail.type === 'none') return true;

      // 4. Rango horario (partial)
      if (empAvail.type === 'partial') {
        let aStart = timeToMinutes(empAvail.start);
        let aEnd = timeToMinutes(empAvail.end);
        if (aEnd <= aStart) aEnd += 1440; // Medianoche

        for (let p of parts) {
          const [bizId, shiftId] = p.split('|');
          const shifts = this.config.shifts[bizId] || {};
          const shiftDetail = shifts[shiftId];
          if (!shiftDetail) continue;

          let startStr = shiftDetail.start;
          let endStr = shiftDetail.end;
          if (shiftDetail.days && shiftDetail.days[day]) {
            startStr = shiftDetail.days[day].start;
            endStr = shiftDetail.days[day].end;
          }

          let sStart = timeToMinutes(startStr);
          let sEnd = timeToMinutes(endStr);
          if (sEnd <= sStart) sEnd += 1440; // Medianoche

          if ((aStart > sStart) || (sEnd > aEnd)) {
            return true; // Excede disponibilidad
          }
        }
      }

      // 5. Verificar solapamiento horario si hay 2 turnos asignados
      if (parts.length === 2) {
        const intervals = [];
        for (let p of parts) {
          const [bId, sId] = p.split('|');
          const shifts = this.config.shifts[bId] || {};
          const shiftDetail = shifts[sId];
          if (shiftDetail) {
            let startStr = shiftDetail.start;
            let endStr = shiftDetail.end;
            if (shiftDetail.days && shiftDetail.days[day]) {
              startStr = shiftDetail.days[day].start;
              endStr = shiftDetail.days[day].end;
            }
            let s = timeToMinutes(startStr);
            let e = timeToMinutes(endStr);
            if (e <= s) e += 1440;
            intervals.push({ s, e });
          }
        }
        if (intervals.length === 2) {
          const [i1, i2] = intervals;
          const overlaps = Math.max(i1.s, i2.s) < Math.min(i1.e, i2.e);
          if (overlaps) return true; // Conflicto: solapamiento!
        }
      }

      return false;
    },

    // Genera el texto explicativo de la violación para el tooltip
    getCellViolationReason(employee, day, assignValue) {
      if (assignValue === 'Descanso' || !assignValue) return '';
      
      const parts = assignValue.split(',');

      // 1. Local
      for (let p of parts) {
        const [bizId, shiftId] = p.split('|');
        if (employee.assignedBusinessId && employee.assignedBusinessId !== 'indiferente' && employee.assignedBusinessId !== '' && employee.assignedBusinessId !== bizId) {
          const bizName = this.config.businesses.find(b => b.id === employee.assignedBusinessId)?.name || 'otro local';
          return `El empleado pertenece obligatoriamente al local "${bizName}" y no se puede programar en este local.`;
        }
      }
      
      // 2. Inactividad
      for (let p of parts) {
        const [bizId, shiftId] = p.split('|');
        const shifts = this.config.shifts[bizId] || {};
        const shiftDetail = shifts[shiftId];
        if (shiftDetail && shiftDetail.days && shiftDetail.days[day] && !shiftDetail.days[day].active) {
          return `El turno "${shiftDetail.name}" está desactivado (no incluido) para el ${day}.`;
        }
      }

      const empAvail = employee.availability?.[day] || 
                       (employee.unavailableDays && employee.unavailableDays.includes(day) ? { type: 'none' } : { type: 'full' });

      if (empAvail.type === 'none') {
        return 'El empleado está marcado como No Disponible (Descanso fijo) este día.';
      }

      if (empAvail.type === 'partial') {
        let aStart = timeToMinutes(empAvail.start);
        let aEnd = timeToMinutes(empAvail.end);
        if (aEnd <= aStart) aEnd += 1440; // Medianoche

        for (let p of parts) {
          const [bizId, shiftId] = p.split('|');
          const shifts = this.config.shifts[bizId] || {};
          const shiftDetail = shifts[shiftId];
          if (!shiftDetail) continue;

          let startStr = shiftDetail.start;
          let endStr = shiftDetail.end;
          if (shiftDetail.days && shiftDetail.days[day]) {
            startStr = shiftDetail.days[day].start;
            endStr = shiftDetail.days[day].end;
          }

          let sStart = timeToMinutes(startStr);
          let sEnd = timeToMinutes(endStr);
          if (sEnd <= sStart) sEnd += 1440; // Medianoche

          if ((aStart > sStart) || (sEnd > aEnd)) {
            return `Horas del turno (${startStr}-${endStr}) fuera de la disponibilidad parcial indicada por el empleado (${empAvail.start}-${empAvail.end}).`;
          }
        }
      }

      // 3. Solapamiento
      if (parts.length === 2) {
        const intervals = [];
        const names = [];
        for (let p of parts) {
          const [bId, sId] = p.split('|');
          const shifts = this.config.shifts[bId] || {};
          const shiftDetail = shifts[sId];
          if (shiftDetail) {
            names.push(shiftDetail.name);
            let startStr = shiftDetail.start;
            let endStr = shiftDetail.end;
            if (shiftDetail.days && shiftDetail.days[day]) {
              startStr = shiftDetail.days[day].start;
              endStr = shiftDetail.days[day].end;
            }
            let s = timeToMinutes(startStr);
            let e = timeToMinutes(endStr);
            if (e <= s) e += 1440;
            intervals.push({ s, e });
          }
        }
        if (intervals.length === 2) {
          const [i1, i2] = intervals;
          const overlaps = Math.max(i1.s, i2.s) < Math.min(i1.e, i2.e);
          if (overlaps) {
            return `Los turnos asignados (${names[0]} y ${names[1]}) se solapan en su horario de trabajo.`;
          }
        }
      }

      return '';
    },

    isHoursViolated(employee) {
      if (employee.maxHours === 'Indefinido') return false;
      return this.calculateWeeklyHours(employee.id) > employee.maxHours;
    },

    // API: Empleado guarda preferencias móviles
    async saveEmployeePreferences() {
      this.saving = true;
      try {
        const res = await this.apiFetch(`/api/employees/${this.selectedEmployeeId}/preferences`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(this.employeePrefForm)
        });
        if (!res.ok) throw new Error();
        if (this.isEmployeePortal) {
          await this.fetchEmployeePortal();
        } else {
          await this.fetchEmployees();
        }
        this.showToast('Tus preferencias e intervalos de horarios se han actualizado con éxito');
      } catch (err) {
        this.showToast('Error al actualizar tus preferencias', 'error');
      } finally {
        this.saving = false;
      }
    },

    // --- HELPER COMPATIBILIDAD VUE TEMPLATE ---
    getShiftName(shiftId, bizId) {
      if (!bizId || !shiftId || !this.config.shifts[bizId]) return '';
      const s = this.config.shifts[bizId][shiftId];
      return s ? s.name : '';
    },

    getShiftTime(shiftId, bizId, day) {
      if (!bizId || !shiftId || !this.config.shifts[bizId]) return '';
      const s = this.config.shifts[bizId][shiftId];
      if (!s) return '';
      if (day && s.days && s.days[day]) {
        if (!s.days[day].active) return 'Inactivo';
        return `${s.days[day].start} - ${s.days[day].end}`;
      }
      return `${s.start} - ${s.end}`;
    },

    getBusinessShifts(bizId) {
      if (!bizId) return {};
      return this.config.shifts[bizId] || {};
    },

    getDemandSummary(bizId, day, shiftId, role) {
      if (!bizId || !this.demandSummary[bizId] || !this.demandSummary[bizId][day] || !this.demandSummary[bizId][day][shiftId]) {
        return { assigned: 0, demanded: 0, state: 'ok' };
      }
      return this.demandSummary[bizId][day][shiftId][role] || { assigned: 0, demanded: 0, state: 'ok' };
    },

    getEmployeeAvailType(emp, day) {
      if (!emp) return 'full';
      if (emp.availability && emp.availability[day]) {
        return emp.availability[day].type;
      }
      if (emp.unavailableDays && emp.unavailableDays.includes(day)) {
        return 'none';
      }
      return 'full';
    },

    getEmployeeAvailText(emp, day) {
      if (!emp) return 'Libre';
      if (emp.availability && emp.availability[day]) {
        const av = emp.availability[day];
        if (av.type === 'none') return 'Desc';
        if (av.type === 'partial') return av.start || 'Horas';
        return 'Libre';
      }
      if (emp.unavailableDays && emp.unavailableDays.includes(day)) {
        return 'Desc';
      }
      return 'Libre';
    },

    getEmployeeAvailTooltip(emp, day) {
      if (!emp) return '';
      if (emp.availability && emp.availability[day]) {
        const av = emp.availability[day];
        if (av.type === 'partial') {
          return `Disponible de ${av.start} a ${av.end}`;
        }
      }
      return '';
    },

    getShiftColorClass(shiftId, bizId) {
      if (!bizId || !shiftId || !this.config.shifts[bizId]) return 'bg-slate-500';
      const s = this.config.shifts[bizId][shiftId];
      return s && s.color ? `bg-${s.color}-500` : 'bg-cyan-500';
    },

    toggleCellPopover(empId, day) {
      if (this.activePopover && this.activePopover.empId === empId && this.activePopover.day === day) {
        this.activePopover = null;
      } else {
        this.activePopover = { empId, day };
      }
    },

    isShiftAssigned(empId, day, value) {
      const val = this.assignments[empId]?.[day] || 'Descanso';
      if (value === 'Descanso') {
        return val === 'Descanso';
      }
      return val.split(',').includes(value);
    },

    async toggleShiftAssignment(empId, day, value) {
      if (!this.assignments[empId]) {
        this.assignments[empId] = {};
      }
      let current = this.assignments[empId][day] || 'Descanso';

      if (value === 'Descanso') {
        this.assignments[empId][day] = 'Descanso';
      } else {
        let arr = current === 'Descanso' ? [] : current.split(',');
        if (arr.includes(value)) {
          arr = arr.filter(v => v !== value);
        } else {
          if (arr.length >= 2) {
            this.showToast('Un empleado no puede realizar más de 2 turnos el mismo día', 'warning');
            return;
          }
          arr.push(value);
        }
        this.assignments[empId][day] = arr.length > 0 ? arr.join(',') : 'Descanso';
      }

      // Guardar asignaciones en caliente inmediatamente
      await this.saveAssignments();
    },

    getPartDisplayText(part) {
      if (!part) return '';
      const [bId, sId] = part.split('|');
      const sName = this.getShiftName(sId, bId);
      const displayName = sName || sId;
      // Eliminar el nombre del local entre paréntesis (ej. "Mañana (La Bodeguilla)" -> "Mañana")
      return displayName.replace(/\s*\(.*\)/g, '').trim();
    },

    getPartBadgeClass(part) {
      const [bId, sId] = part.split('|');
      if (!bId || !sId || !this.config.shifts[bId]) return 'bg-cyan-500/15 text-indigo-800 dark:text-indigo-300 border border-indigo-300/40 dark:border-indigo-700/30';
      const s = this.config.shifts[bId][sId];
      const color = s && s.color ? s.color : 'indigo';
      
      const colorMaps = {
        amber: 'bg-amber-500/15 text-amber-800 dark:text-amber-300 border border-amber-300/40 dark:border-amber-700/30',
        orange: 'bg-orange-500/15 text-orange-800 dark:text-orange-300 border border-orange-300/40 dark:border-orange-700/30',
        indigo: 'bg-cyan-500/15 text-indigo-800 dark:text-indigo-300 border border-indigo-300/40 dark:border-indigo-700/30',
        sky: 'bg-sky-500/15 text-sky-800 dark:text-sky-300 border border-sky-300/40 dark:border-sky-700/30',
        emerald: 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 border border-emerald-300/40 dark:border-emerald-700/30',
        red: 'bg-red-500/15 text-red-800 dark:text-red-300 border border-red-300/40 dark:border-red-700/30',
        purple: 'bg-purple-500/15 text-purple-800 dark:text-purple-300 border border-purple-300/40 dark:border-purple-700/30',
        pink: 'bg-pink-500/15 text-pink-800 dark:text-pink-300 border border-pink-300/40 dark:border-pink-700/30',
        rose: 'bg-rose-500/15 text-rose-800 dark:text-rose-300 border border-rose-300/40 dark:border-rose-700/30',
        teal: 'bg-teal-500/15 text-teal-800 dark:text-teal-300 border border-teal-300/40 dark:border-teal-700/30',
        cyan: 'bg-cyan-500/15 text-cyan-800 dark:text-cyan-300 border border-cyan-300/40 dark:border-cyan-700/30',
        blue: 'bg-blue-500/15 text-blue-800 dark:text-blue-300 border border-blue-300/40 dark:border-blue-700/30',
        violet: 'bg-teal-500/15 text-teal-800 dark:text-teal-300 border border-teal-300/40 dark:border-teal-700/30',
        fuchsia: 'bg-fuchsia-500/15 text-fuchsia-800 dark:text-fuchsia-300 border border-fuchsia-300/40 dark:border-fuchsia-700/30',
      };
      
      return colorMaps[color] || `bg-${color}-500/15 text-${color}-800 dark:text-${color}-300 border border-${color}-300/40 dark:border-${color}-700/30`;
    },

    getCellDisplayText(emp, day) {
      const val = this.assignments[emp.id]?.[day] || 'Descanso';
      if (val === 'Descanso') return '🏖️ Descanso';

      const parts = val.split(',');
      if (parts.length === 1) {
        const [bId, sId] = parts[0].split('|');
        const sName = this.getShiftName(sId, bId);
        return sName || sId;
      } else {
        return parts.map(p => {
          const [bId, sId] = p.split('|');
          const sName = this.getShiftName(sId, bId);
          return sName || sId;
        }).join(' + ');
      }
    },

    getCellClass(emp, day) {
      const val = this.assignments[emp.id]?.[day] || 'Descanso';
      const violated = this.isCellViolated(emp, day, val);

      const classes = {
        'border-red-500 ring-2 ring-red-500/20 animate-pulse-warning dark:border-red-500/50': violated
      };

      if (val === 'Descanso') {
        classes['bg-slate-100 dark:bg-slate-800/40 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-800 hover:bg-slate-200/50 dark:hover:bg-slate-800/70'] = true;
      } else {
        const parts = val.split(',');
        if (parts.length > 1) {
          classes['bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-300 dark:border-purple-700/50 hover:bg-purple-500/15 font-extrabold'] = true;
        } else {
          const sId = parts[0].split('|')[1];
          if (sId.includes('Manana')) {
            classes['bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-700/50 hover:bg-amber-500/15'] = true;
          } else if (sId.includes('Tarde')) {
            classes['bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-300 dark:border-orange-700/50 hover:bg-orange-500/15'] = true;
          } else if (sId.includes('Noche')) {
            classes['bg-cyan-500/10 text-indigo-700 dark:text-cyan-400 border-indigo-300 dark:border-indigo-700/50 hover:bg-cyan-500/15'] = true;
          } else {
            classes['bg-sky-500/10 text-sky-700 dark:text-sky-400 border-sky-300 dark:border-sky-700/50 hover:bg-sky-500/15'] = true;
          }
        }
      }

      return classes;
    },

    printCalendar() {
      const days        = this.days;
      const employees   = this.employees;
      const assignments = this.assignments;
      const config      = this.config;
      const businesses  = config.businesses || [];
      const today       = new Date().toLocaleDateString('es-ES', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
      });

      if (businesses.length === 0) {
        this.showToast('No hay locales configurados.', 'warning');
        return;
      }

      // ── Helpers ──────────────────────────────────────────────────────────────
      const getShiftName = (sId, bId) => {
        const s = config.shifts?.[bId]?.[sId];
        return s ? s.name : sId;
      };
      const getShiftTime = (sId, bId) => {
        const s = config.shifts?.[bId]?.[sId];
        return s && s.start && s.end ? `${s.start}–${s.end}` : '';
      };
      const shiftBadgeStyle = (sId) => {
        const id = (sId || '').toLowerCase();
        if (id.includes('manana')) return 'background:#FEF3C7;color:#92400E;border:1px solid #FDE68A';
        if (id.includes('tarde'))  return 'background:#FFEDD5;color:#9A3412;border:1px solid #FDBA74';
        if (id.includes('noche'))  return 'background:#CFFAFE;color:#155E75;border:1px solid #67E8F9';
        return 'background:#E0F2FE;color:#075985;border:1px solid #BAE6FD';
      };

      // Paleta de acentos por negocio (se rota en bucle)
      const bizPalettes = [
        { grad: 'linear-gradient(135deg,#0891B2,#818CF8)', accent: '#0891B2', light: '#ECFEFF', text: '#0E7490' },
        { grad: 'linear-gradient(135deg,#0EA5E9,#38BDF8)', accent: '#0EA5E9', light: '#E0F2FE', text: '#0369A1' },
        { grad: 'linear-gradient(135deg,#10B981,#34D399)', accent: '#10B981', light: '#D1FAE5', text: '#065F46' },
        { grad: 'linear-gradient(135deg,#F59E0B,#FBBF24)', accent: '#F59E0B', light: '#FEF3C7', text: '#92400E' },
        { grad: 'linear-gradient(135deg,#EF4444,#F87171)', accent: '#EF4444', light: '#FEE2E2', text: '#991B1B' },
        { grad: 'linear-gradient(135deg,#8B5CF6,#A78BFA)', accent: '#8B5CF6', light: '#EDE9FE', text: '#5B21B6' },
        { grad: 'linear-gradient(135deg,#EC4899,#F472B6)', accent: '#EC4899', light: '#FCE7F3', text: '#9D174D' },
      ];

      const dayHeaderGrads = [
        'linear-gradient(135deg,#0891B2,#06B6D4)',
        'linear-gradient(135deg,#0EA5E9,#38BDF8)',
        'linear-gradient(135deg,#10B981,#34D399)',
        'linear-gradient(135deg,#F59E0B,#FCD34D)',
        'linear-gradient(135deg,#EF4444,#F87171)',
        'linear-gradient(135deg,#8B5CF6,#A78BFA)',
        'linear-gradient(135deg,#06B6D4,#818CF8)',
      ];
      const dayTextColor = ['#fff','#fff','#fff','#1E293B','#fff','#fff','#fff'];

      // ── Build one page per business ───────────────────────────────────────────
      const buildPage = (biz, palette, isLast) => {

        const columns = days.map((day, di) => {

          // Empleados que trabajan en ESTE negocio ese día
          const working = employees.filter(emp => {
            const v = assignments[emp.id]?.[day] || 'Descanso';
            if (v === 'Descanso') return false;
            return v.split(',').some(part => part.startsWith(biz.id + '|'));
          });

          // Empleados en descanso o en OTRO negocio ese día (no en éste)
          const notHere = employees.length - working.length;

          const cards = working.map(emp => {
            const val = assignments[emp.id][day];
            // Sólo los turnos de ESTE negocio
            const parts = val.split(',').filter(p => p.startsWith(biz.id + '|'));
            const isDouble = parts.length > 1;
            const entryBg     = isDouble ? '#F5F3FF' : '#FFFFFF';
            const entryBorder = isDouble ? '#C4B5FD' : '#E2E8F0';

            const badges = parts.map(part => {
              const [bId, sId] = part.split('|');
              const name = getShiftName(sId, bId);
              const time = getShiftTime(sId, bId);
              const st   = shiftBadgeStyle(sId);
              return `<span style="${st};font-size:6.5px;font-weight:800;padding:1.5px 5px;border-radius:3px;display:inline-block;margin:1px 1px 0 0;white-space:nowrap;">${name}${time ? ' · ' + time : ''}</span>`;
            }).join('');

            return `
              <div style="background:${entryBg};border:1px solid ${entryBorder};border-radius:6px;padding:4px 6px;margin-bottom:3px;">
                <div style="font-size:8.5px;font-weight:800;color:#1E293B;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${emp.name}</div>
                <div style="font-size:6.5px;color:${palette.accent};font-weight:700;margin-bottom:2px;">${emp.role || ''}</div>
                <div>${badges}</div>
              </div>`;
          }).join('');

          const restTag = notHere > 0
            ? `<div style="margin-top:auto;padding:3px 5px;background:#F1F5F9;border:1px solid #E2E8F0;border-radius:4px;font-size:7px;color:#94A3B8;font-weight:700;text-align:center;">🏖 ${notHere} fuera de este local</div>`
            : '';

          return `
            <div style="border:1.5px solid #E2E8F0;border-radius:10px;overflow:hidden;display:flex;flex-direction:column;min-height:0;">
              <div style="background:${dayHeaderGrads[di]};color:${dayTextColor[di]};text-align:center;padding:7px 4px;font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:0.8px;">
                ${day}
              </div>
              <div style="flex:1;padding:5px;background:#FAFBFF;display:flex;flex-direction:column;gap:0;overflow:hidden;">
                ${cards || '<div style="color:#CBD5E1;font-size:8px;text-align:center;padding:12px 0;">Sin asignaciones</div>'}
                ${restTag}
              </div>
            </div>`;
        }).join('');

        const pageBreak = isLast ? '' : 'page-break-after:always;';

        return `
          <div class="page" style="${pageBreak}width:100%;height:100vh;display:flex;flex-direction:column;">
            <!-- Cabecera de negocio -->
            <div style="display:flex;justify-content:space-between;align-items:center;padding-bottom:8px;margin-bottom:8px;border-bottom:3px solid ${palette.accent};flex-shrink:0;">
              <div>
                <div style="font-size:15px;font-weight:900;color:#1E293B;letter-spacing:-0.3px;">📅 PLANIFICACIÓN SEMANAL DE TURNOS</div>
                <div style="display:flex;align-items:center;gap:8px;margin-top:4px;">
                  <span style="background:${palette.grad};color:#fff;font-size:9px;font-weight:800;padding:3px 12px;border-radius:99px;letter-spacing:0.4px;">🏢 ${biz.name.toUpperCase()}</span>
                  <span style="font-size:9px;color:#94A3B8;font-weight:600;">Generado el ${today}</span>
                </div>
              </div>
              <div style="text-align:right;">
                <span style="background:${palette.light};color:${palette.text};font-size:8.5px;font-weight:800;padding:3px 12px;border-radius:99px;letter-spacing:0.5px;text-transform:uppercase;">Documento Oficial</span>
                <div style="font-size:8px;color:#94A3B8;margin-top:5px;">${employees.length} empleados · ${days.length} días</div>
              </div>
            </div>
            <!-- Cuadrícula de días -->
            <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:6px;flex:1;min-height:0;">
              ${columns}
            </div>
          </div>`;
      };

      // ── Ensamblar todas las páginas ───────────────────────────────────────────
      const allPages = businesses.map((biz, i) => {
        const palette  = bizPalettes[i % bizPalettes.length];
        const isLast   = i === businesses.length - 1;
        return buildPage(biz, palette, isLast);
      }).join('\n');

      // ── Full HTML document ────────────────────────────────────────────────────
      const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Cuadrantes Semanales · ${config.venueName || 'Shiftly'}</title>
  <style>
    @page { size: A4 landscape; margin: 8mm; }
    *, *::before, *::after { box-sizing: border-box; }
    html, body {
      margin: 0; padding: 0;
      font-family: 'Segoe UI', Arial, Helvetica, sans-serif;
      background: #ffffff;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    @media print {
      .page { height: 100vh !important; }
    }
  </style>
</head>
<body>
  ${allPages}
</body>
</html>`;

      // ── Open and print ────────────────────────────────────────────────────────
      const win = window.open('', '_blank', 'width=1280,height=880');
      if (!win) {
        this.showToast('Activa las ventanas emergentes para poder imprimir.', 'warning');
        return;
      }
      win.document.write(html);
      win.document.close();
      win.focus();
      setTimeout(() => win.print(), 700);
    },

    downloadExcel() {
      try {
        this.saving = true;
        this.showToast('Generando archivo Excel...', 'info');

        const XLSX = window.XLSX;
        if (!XLSX) {
          this.showToast('La librería Excel no está disponible. Recarga la página.', 'error');
          this.saving = false;
          return;
        }

        const days = this.days;
        const employees = this.employees;
        const venueName = this.config.venueName || 'Shiftly';
        const today = new Date().toLocaleDateString('es-ES', {
          weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
        });

        // ── Helpers ──────────────────────────────────────────────────────────
        const resolveShiftText = (val) => {
          if (!val || val === 'Descanso') return '🏖️ DESCANSO';
          return val.split(',').map(part => {
            const [bId, sId] = part.split('|');
            const biz = this.config.businesses.find(b => b.id === bId);
            const bizName = biz ? biz.name : bId;
            const sName = this.getShiftName(sId, bId) || sId;
            return `${sName.toUpperCase()} · ${bizName}`;
          }).join('\n');
        };

        const weeklyHours = (empId) => this.calculateWeeklyHours(empId);

        // ── Colores de fondo por tipo de celda ───────────────────────────────
        // ARGB: FF + RRGGBB
        const getCellFill = (val) => {
          if (!val || val === 'Descanso') return 'FFF1F5F9'; // slate-100
          const parts = val.split(',');
          if (parts.length > 1)            return 'FFEDE9FE'; // violet-100 → turno partido
          const sId = parts[0].split('|')[1] || '';
          if (sId.includes('Manana'))      return 'FFFEF3C7'; // amber-100
          if (sId.includes('Tarde'))       return 'FFFFEDD5'; // orange-100
          if (sId.includes('Noche'))       return 'FFE0E7FF'; // indigo-100
          return 'FFE0F2FE';                                   // sky-100
        };

        // ── Estilo de borde fino ─────────────────────────────────────────────
        const thinBorder = {
          top:    { style: 'thin', color: { argb: 'FFCBD5E1' } },
          bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
          left:   { style: 'thin', color: { argb: 'FFCBD5E1' } },
          right:  { style: 'thin', color: { argb: 'FFCBD5E1' } }
        };

        const thickBorder = {
          top:    { style: 'medium', color: { argb: 'FF06B6D4' } },
          bottom: { style: 'medium', color: { argb: 'FF06B6D4' } },
          left:   { style: 'medium', color: { argb: 'FF06B6D4' } },
          right:  { style: 'medium', color: { argb: 'FF06B6D4' } }
        };

        // ── Crear workbook ───────────────────────────────────────────────────
        const wb = XLSX.utils.book_new();
        const ws = {};

        let rowIdx = 1; // 1-indexed

        // ── FILA 1: Título del documento ─────────────────────────────────────
        const titleCell = `A${rowIdx}`;
        ws[titleCell] = {
          v: `📅 PLANIFICACIÓN SEMANAL DE TURNOS — ${venueName.toUpperCase()}`,
          t: 's',
          s: {
            font: { bold: true, sz: 16, color: { argb: 'FF4338CA' }, name: 'Calibri' },
            fill: { fgColor: { argb: 'FFF5F3FF' }, patternType: 'solid' },
            alignment: { horizontal: 'left', vertical: 'center', wrapText: false }
          }
        };
        rowIdx++;

        // ── FILA 2: Fecha de generación ──────────────────────────────────────
        ws[`A${rowIdx}`] = {
          v: `Generado el ${today}`,
          t: 's',
          s: {
            font: { italic: true, sz: 10, color: { argb: 'FF64748B' }, name: 'Calibri' },
            fill: { fgColor: { argb: 'FFF5F3FF' }, patternType: 'solid' }
          }
        };
        rowIdx++;

        // ── FILA 3: Vacía (separador) ────────────────────────────────────────
        rowIdx++;

        // ── FILA 4: Cabeceras de columna ─────────────────────────────────────
        const headerRow = rowIdx;
        const headerStyle = {
          font: { bold: true, sz: 11, color: { argb: 'FFFFFFFF' }, name: 'Calibri' },
          fill: { fgColor: { argb: 'FF0891B2' }, patternType: 'solid' },
          alignment: { horizontal: 'center', vertical: 'center', wrapText: false },
          border: thinBorder
        };

        const colNames = ['Empleado', 'Rol', 'Horas semana', ...days];
        colNames.forEach((name, ci) => {
          const addr = XLSX.utils.encode_cell({ r: rowIdx - 1, c: ci });
          ws[addr] = { v: name, t: 's', s: headerStyle };
        });
        rowIdx++;

        // ── FILAS de empleados ───────────────────────────────────────────────
        employees.forEach((emp) => {
          const totalH = weeklyHours(emp.id);
          const maxH = emp.maxHours === 'Indefinido' ? '∞' : `${emp.maxHours}h`;
          const over = emp.maxHours !== 'Indefinido' && totalH > emp.maxHours;

          // Columna A – Nombre
          ws[XLSX.utils.encode_cell({ r: rowIdx - 1, c: 0 })] = {
            v: emp.name,
            t: 's',
            s: {
              font: { bold: true, sz: 11, name: 'Calibri', color: { argb: 'FF1E293B' } },
              alignment: { vertical: 'center', wrapText: false },
              border: thinBorder
            }
          };

          // Columna B – Rol
          ws[XLSX.utils.encode_cell({ r: rowIdx - 1, c: 1 })] = {
            v: emp.role || '—',
            t: 's',
            s: {
              font: { sz: 10, color: { argb: 'FF06B6D4' }, name: 'Calibri', bold: true },
              alignment: { horizontal: 'center', vertical: 'center' },
              border: thinBorder
            }
          };

          // Columna C – Horas
          ws[XLSX.utils.encode_cell({ r: rowIdx - 1, c: 2 })] = {
            v: `${totalH}h / ${maxH}`,
            t: 's',
            s: {
              font: { bold: true, sz: 11, color: { argb: over ? 'FFEF4444' : 'FF10B981' }, name: 'Calibri' },
              alignment: { horizontal: 'center', vertical: 'center' },
              fill: { fgColor: { argb: over ? 'FFFEE2E2' : 'FFD1FAE5' }, patternType: 'solid' },
              border: thinBorder
            }
          };

          // Columnas de días
          days.forEach((day, di) => {
            const raw = this.assignments[emp.id]?.[day] || 'Descanso';
            const text = resolveShiftText(raw);
            const fill = getCellFill(raw);
            const isRest = !raw || raw === 'Descanso';
            ws[XLSX.utils.encode_cell({ r: rowIdx - 1, c: 3 + di })] = {
              v: text,
              t: 's',
              s: {
                font: {
                  sz: isRest ? 10 : 10,
                  bold: !isRest,
                  color: { argb: isRest ? 'FF94A3B8' : 'FF1E293B' },
                  name: 'Calibri'
                },
                fill: { fgColor: { argb: fill }, patternType: 'solid' },
                alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
                border: thinBorder
              }
            };
          });

          rowIdx++;
        });

        // ── Definir rango de la hoja ──────────────────────────────────────────
        const totalCols = 3 + days.length;
        const totalRows = rowIdx - 1;
        ws['!ref'] = XLSX.utils.encode_range({ r: 0, c: 0 }, { r: totalRows - 1, c: totalCols - 1 });

        // ── Anchos de columna (en caracteres) ────────────────────────────────
        ws['!cols'] = [
          { wch: 28 },  // Empleado
          { wch: 16 },  // Rol
          { wch: 16 },  // Horas
          ...days.map(() => ({ wch: 24 }))  // Días
        ];

        // ── Altos de fila ────────────────────────────────────────────────────
        const rowHeights = [];
        for (let r = 0; r < totalRows; r++) {
          if (r === 0) rowHeights.push({ hpt: 36 });         // Título
          else if (r === 1) rowHeights.push({ hpt: 20 });    // Fecha
          else if (r === 2) rowHeights.push({ hpt: 10 });    // Separador
          else if (r === headerRow - 1) rowHeights.push({ hpt: 24 }); // Cabecera
          else rowHeights.push({ hpt: 52 });                  // Empleados
        }
        ws['!rows'] = rowHeights;

        // ── Merge del título y fecha a toda la fila ──────────────────────────
        ws['!merges'] = [
          { s: { r: 0, c: 0 }, e: { r: 0, c: totalCols - 1 } },
          { s: { r: 1, c: 0 }, e: { r: 1, c: totalCols - 1 } }
        ];

        // ── Añadir hoja al workbook y descargar ───────────────────────────────
        XLSX.utils.book_append_sheet(wb, ws, 'Cuadrante Semanal');

        const fileName = `Cuadrante_${venueName.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0,10)}.xlsx`;
        XLSX.writeFile(wb, fileName);

        this.showToast('Excel descargado. Ábrelo y usa Archivo > Guardar como PDF para imprimirlo.', 'success');
      } catch (err) {
        console.error('Error generando Excel:', err);
        this.showToast('Error al generar el archivo Excel', 'error');
      } finally {
        this.saving = false;
      }
    }
  }
}).mount('#app');
