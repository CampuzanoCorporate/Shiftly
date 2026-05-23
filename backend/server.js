import crypto from 'crypto';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import path from 'path';
import { fileURLToPath } from 'url';
import { getData, saveData, createWeekAssignments } from './database.js';
import { autoAssign } from './algorithm.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const frontendPath = path.resolve(__dirname, '../frontend');

app.use(cors());
app.use(express.json());
app.use(morgan('dev'));
app.use(express.static(frontendPath));

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    service: 'shiftly-backend',
    timestamp: new Date().toISOString()
  });
});

function normalizeEmail(email = '') {
  return email.trim().toLowerCase();
}

function hashPassword(password = '') {
  return crypto.createHash('sha256').update(password).digest('hex');
}

function createSessionToken() {
  return crypto.randomBytes(24).toString('hex');
}

function createEmployeeCode() {
  return `EMP-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

function createUniqueEmployeeCode(data) {
  let code = createEmployeeCode();
  const isUsed = candidate =>
    data.auth.registrationCodes.some(item => item.code === candidate) ||
    data.employees.some(item => item.accessCode === candidate);

  while (isUsed(code)) {
    code = createEmployeeCode();
  }

  return code;
}

function sanitizeAdmin(admin) {
  return {
    id: admin.id,
    role: admin.role,
    name: admin.name,
    email: admin.email,
    companyName: admin.companyName,
    licenseKey: admin.licenseKey,
    createdAt: admin.createdAt
  };
}

function sanitizeEmployee(employee) {
  return {
    id: employee.id,
    role: 'employee',
    employeeId: employee.id,
    name: employee.name,
    email: employee.email,
    jobRole: employee.role,
    assignedBusinessId: employee.assignedBusinessId || '',
    maxHours: employee.maxHours,
    preferredShift: employee.preferredShift || 'Indiferente'
  };
}

function findSession(data, token) {
  if (!token) return null;
  return data.auth.sessions.find(session => session.token === token) || null;
}

function readBearerToken(req) {
  const authorization = req.headers.authorization || '';
  if (!authorization.startsWith('Bearer ')) return '';
  return authorization.slice('Bearer '.length).trim();
}

async function resolveSession(req) {
  const token = readBearerToken(req);
  if (!token) return null;

  const data = await getData();
  const session = findSession(data, token);
  if (!session) return null;

  if (session.role === 'admin') {
    const admin = data.auth.users.find(user => user.id === session.userId && user.role === 'admin');
    if (!admin) return null;
    return { data, session, user: admin };
  }

  const employee = data.employees.find(item => item.id === session.employeeId);
  if (!employee) return null;
  return { data, session, user: employee };
}

function requireAuth(role) {
  return async (req, res, next) => {
    try {
      const auth = await resolveSession(req);
      if (!auth) {
        return res.status(401).json({ error: 'Sesión no válida o expirada' });
      }

      if (role && auth.session.role !== role) {
        return res.status(403).json({ error: 'No tienes permisos para realizar esta acción' });
      }

      req.auth = auth;
      next();
    } catch (error) {
      res.status(500).json({ error: 'No se pudo validar la sesión' });
    }
  };
}

function ensureUniqueEmail(data, email, ignoreEmployeeId = '') {
  const normalized = normalizeEmail(email);
  const adminExists = data.auth.users.some(user => normalizeEmail(user.email) === normalized);
  const employeeExists = data.employees.some(
    employee => employee.id !== ignoreEmployeeId && employee.email && normalizeEmail(employee.email) === normalized
  );
  return !(adminExists || employeeExists);
}

app.get('/api/auth/bootstrap', async (req, res) => {
  try {
    const data = await getData();
    const firstAvailableLicense = data.auth.licenseKeys.find(item => item.active && !item.usedBy);

    res.json({
      hasAdminUsers: data.auth.users.some(user => user.role === 'admin'),
      demoLicenseKey: firstAvailableLicense?.key || ''
    });
  } catch (error) {
    res.status(500).json({ error: 'No se pudo preparar la pantalla de acceso' });
  }
});

app.post('/api/auth/register-admin', async (req, res) => {
  try {
    const { name, email, password, companyName, licenseKey } = req.body;
    if (!name || !email || !password || !companyName || !licenseKey) {
      return res.status(400).json({ error: 'Debes completar todos los campos del registro de administrador' });
    }

    const data = await getData();
    if (!ensureUniqueEmail(data, email)) {
      return res.status(409).json({ error: 'Ese email ya está registrado' });
    }

    const license = data.auth.licenseKeys.find(item => item.key === licenseKey.trim());
    if (!license || !license.active || license.usedBy) {
      return res.status(400).json({ error: 'La licencia indicada no es válida o ya está en uso' });
    }

    const admin = {
      id: `admin_${crypto.randomBytes(5).toString('hex')}`,
      role: 'admin',
      name: name.trim(),
      email: normalizeEmail(email),
      passwordHash: hashPassword(password),
      companyName: companyName.trim(),
      licenseKey: license.key,
      createdAt: new Date().toISOString()
    };

    license.usedBy = admin.id;
    license.usedAt = new Date().toISOString();
    data.auth.users.push(admin);

    if (!data.config.venueName || data.config.venueName === 'Grupo Gastronómico Shiftly') {
      data.config.venueName = companyName.trim();
    }

    await saveData(data);
    res.status(201).json({ message: 'Administrador registrado correctamente' });
  } catch (error) {
    res.status(500).json({ error: 'No se pudo completar el registro del administrador' });
  }
});

app.post('/api/auth/register-employee', async (req, res) => {
  try {
    const { name, email, password, registrationCode } = req.body;
    if (!email || !password || !registrationCode) {
      return res.status(400).json({ error: 'Debes completar email, contraseña y código de acceso' });
    }

    const data = await getData();
    if (!ensureUniqueEmail(data, email)) {
      return res.status(409).json({ error: 'Ese email ya está registrado' });
    }

    const normalizedCode = registrationCode.trim().toUpperCase();
    const invitedEmployee = data.employees.find(
      item => item.accessCode === normalizedCode && item.accountStatus !== 'active'
    );

    if (invitedEmployee) {
      invitedEmployee.email = normalizeEmail(email);
      invitedEmployee.passwordHash = hashPassword(password);
      invitedEmployee.accountStatus = 'active';
      invitedEmployee.accessCodeClaimedAt = new Date().toISOString();
      invitedEmployee.createdAt = invitedEmployee.createdAt || new Date().toISOString();

      if (name && name.trim()) {
        invitedEmployee.name = name.trim();
      }

      await saveData(data);
      return res.status(201).json({ message: 'Empleado activado correctamente' });
    }

    const code = data.auth.registrationCodes.find(
      item => item.code === normalizedCode
    );

    if (!code || !code.active || code.claimedByEmployeeId) {
      return res.status(400).json({ error: 'El código de registro no es válido o ya fue utilizado' });
    }

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Debes indicar tu nombre para completar el alta' });
    }

    const employee = {
      id: `emp_${crypto.randomBytes(5).toString('hex')}`,
      name: name.trim(),
      email: normalizeEmail(email),
      passwordHash: hashPassword(password),
      role: code.role || 'Camarero',
      maxHours: code.maxHours === 'Indefinido' ? 'Indefinido' : Number(code.maxHours || 40),
      preferredShift: code.preferredShift || 'Indiferente',
      assignedBusinessId: code.assignedBusinessId || '',
      availability: {},
      createdAt: new Date().toISOString(),
      accountStatus: 'active',
      registrationCode: code.code,
      accessCode: code.code
    };

    data.employees.push(employee);
    data.assignments[employee.id] = createWeekAssignments();

    code.active = false;
    code.claimedByEmployeeId = employee.id;
    code.claimedAt = new Date().toISOString();

    await saveData(data);
    res.status(201).json({ message: 'Empleado registrado correctamente' });
  } catch (error) {
    res.status(500).json({ error: 'No se pudo completar el registro del empleado' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password, role } = req.body;
    if (!email || !password || !role) {
      return res.status(400).json({ error: 'Debes indicar email, contraseña y tipo de acceso' });
    }

    const data = await getData();
    const normalizedEmail = normalizeEmail(email);
    const passwordHash = hashPassword(password);
    let user;
    let session;

    if (role === 'admin') {
      user = data.auth.users.find(
        item => item.role === 'admin' && normalizeEmail(item.email) === normalizedEmail && item.passwordHash === passwordHash
      );

      if (!user) {
        return res.status(401).json({ error: 'Credenciales de administrador incorrectas' });
      }

      session = {
        token: createSessionToken(),
        role: 'admin',
        userId: user.id,
        createdAt: new Date().toISOString()
      };

      data.auth.sessions.push(session);
      await saveData(data);

      return res.json({
        token: session.token,
        role: 'admin',
        user: sanitizeAdmin(user)
      });
    }

    user = data.employees.find(
      item => item.email && normalizeEmail(item.email) === normalizedEmail && item.passwordHash === passwordHash
    );

    if (!user) {
      return res.status(401).json({ error: 'Credenciales de empleado incorrectas' });
    }

    session = {
      token: createSessionToken(),
      role: 'employee',
      employeeId: user.id,
      createdAt: new Date().toISOString()
    };

    data.auth.sessions.push(session);
    await saveData(data);

    res.json({
      token: session.token,
      role: 'employee',
      user: sanitizeEmployee(user)
    });
  } catch (error) {
    res.status(500).json({ error: 'No se pudo iniciar sesión' });
  }
});

app.get('/api/auth/me', async (req, res) => {
  try {
    const auth = await resolveSession(req);
    if (!auth) {
      return res.status(401).json({ error: 'Sesión no válida o expirada' });
    }

    if (auth.session.role === 'admin') {
      return res.json({ role: 'admin', user: sanitizeAdmin(auth.user) });
    }

    res.json({ role: 'employee', user: sanitizeEmployee(auth.user) });
  } catch (error) {
    res.status(500).json({ error: 'No se pudo recuperar la sesión' });
  }
});

app.post('/api/auth/logout', async (req, res) => {
  try {
    const token = readBearerToken(req);
    if (!token) {
      return res.json({ message: 'Sesión cerrada' });
    }

    const data = await getData();
    data.auth.sessions = data.auth.sessions.filter(session => session.token !== token);
    await saveData(data);
    res.json({ message: 'Sesión cerrada correctamente' });
  } catch (error) {
    res.status(500).json({ error: 'No se pudo cerrar la sesión' });
  }
});

app.get('/api/config', requireAuth('admin'), async (req, res) => {
  try {
    res.json({
      config: req.auth.data.config,
      demands: req.auth.data.demands
    });
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener la configuración' });
  }
});

app.post('/api/config', requireAuth('admin'), async (req, res) => {
  try {
    const { config, demands } = req.body;
    const data = req.auth.data;

    if (config) data.config = config;
    if (demands) data.demands = demands;

    await saveData(data);
    res.json({ message: 'Configuración guardada correctamente', config: data.config, demands: data.demands });
  } catch (error) {
    res.status(500).json({ error: 'Error al guardar la configuración' });
  }
});

app.get('/api/employees', requireAuth('admin'), async (req, res) => {
  try {
    res.json(req.auth.data.employees || []);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener los empleados' });
  }
});

app.post('/api/employees', requireAuth('admin'), async (req, res) => {
  try {
    const { name, role, maxHours, preferredShift, availability, assignedBusinessId } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'El nombre es obligatorio' });
    }

    const data = req.auth.data;
    const accessCode = createUniqueEmployeeCode(data);
    const newEmployee = {
      id: `emp_${crypto.randomBytes(5).toString('hex')}`,
      name: name.trim(),
      role: role || 'Camarero',
      maxHours: maxHours === 'Indefinido' ? 'Indefinido' : (Number(maxHours) || 40),
      preferredShift: preferredShift || 'Indiferente',
      availability: availability || {},
      assignedBusinessId: assignedBusinessId || '',
      accessCode,
      accountStatus: 'invited',
      createdAt: new Date().toISOString()
    };

    data.employees.push(newEmployee);
    data.assignments[newEmployee.id] = createWeekAssignments();

    await saveData(data);
    res.status(201).json(newEmployee);
  } catch (error) {
    res.status(500).json({ error: 'Error al crear el empleado' });
  }
});

app.put('/api/employees/:id', requireAuth('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, role, maxHours, preferredShift, availability, assignedBusinessId } = req.body;
    const data = req.auth.data;

    const empIndex = data.employees.findIndex(employee => employee.id === id);
    if (empIndex === -1) {
      return res.status(404).json({ error: 'Empleado no encontrado' });
    }

    const currentEmployee = data.employees[empIndex];
    const updated = {
      ...currentEmployee,
      name: name !== undefined ? name : currentEmployee.name,
      role: role !== undefined ? role : currentEmployee.role,
      maxHours: maxHours !== undefined ? (maxHours === 'Indefinido' ? 'Indefinido' : Number(maxHours)) : currentEmployee.maxHours,
      preferredShift: preferredShift !== undefined ? preferredShift : currentEmployee.preferredShift,
      availability: availability !== undefined ? availability : currentEmployee.availability,
      assignedBusinessId: assignedBusinessId !== undefined ? assignedBusinessId : currentEmployee.assignedBusinessId
    };

    data.employees[empIndex] = updated;
    await saveData(data);
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: 'Error al actualizar el empleado' });
  }
});

app.post('/api/employees/:id/access-code', requireAuth('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const data = req.auth.data;
    const employee = data.employees.find(item => item.id === id);

    if (!employee) {
      return res.status(404).json({ error: 'Empleado no encontrado' });
    }

    employee.accessCode = createUniqueEmployeeCode(data);
    employee.accessCodeUpdatedAt = new Date().toISOString();

    await saveData(data);
    res.json({
      message: 'Código regenerado correctamente',
      employee
    });
  } catch (error) {
    res.status(500).json({ error: 'No se pudo regenerar el código del empleado' });
  }
});

app.delete('/api/employees/:id', requireAuth('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const data = req.auth.data;
    const employee = data.employees.find(item => item.id === id);

    data.employees = data.employees.filter(item => item.id !== id);
    if (!employee) {
      return res.status(404).json({ error: 'Empleado no encontrado' });
    }

    if (data.assignments[id]) {
      delete data.assignments[id];
    }

    data.auth.sessions = data.auth.sessions.filter(session => session.employeeId !== id);
    await saveData(data);
    res.json({ message: 'Empleado eliminado correctamente' });
  } catch (error) {
    res.status(500).json({ error: 'Error al eliminar el empleado' });
  }
});

app.get('/api/assignments', requireAuth('admin'), async (req, res) => {
  try {
    res.json(req.auth.data.assignments || {});
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener las asignaciones' });
  }
});

app.post('/api/assignments', requireAuth('admin'), async (req, res) => {
  try {
    const { assignments } = req.body;
    if (!assignments) {
      return res.status(400).json({ error: 'Asignaciones no proporcionadas' });
    }

    const data = req.auth.data;
    data.assignments = assignments;
    await saveData(data);

    res.json({ message: 'Cuadrante guardado correctamente', assignments: data.assignments });
  } catch (error) {
    res.status(500).json({ error: 'Error al guardar el cuadrante' });
  }
});

app.post('/api/assignments/auto', requireAuth('admin'), async (req, res) => {
  try {
    const data = req.auth.data;
    const calculatedAssignments = autoAssign(data);
    data.assignments = calculatedAssignments;
    await saveData(data);

    res.json({
      message: 'Auto-asignación completada de forma inteligente',
      assignments: data.assignments
    });
  } catch (error) {
    console.error('Error en auto-asignación:', error);
    res.status(500).json({ error: 'Error al ejecutar el algoritmo de auto-asignación' });
  }
});

app.get('/api/registration-codes', requireAuth('admin'), async (req, res) => {
  try {
    res.json(req.auth.data.auth.registrationCodes);
  } catch (error) {
    res.status(500).json({ error: 'No se pudieron recuperar los códigos de registro' });
  }
});

app.post('/api/registration-codes', requireAuth('admin'), async (req, res) => {
  try {
    const { role, assignedBusinessId, maxHours, preferredShift, note } = req.body;
    const data = req.auth.data;
    const code = {
      id: `code_${crypto.randomBytes(5).toString('hex')}`,
      code: createEmployeeCode(),
      role: role || 'Camarero',
      assignedBusinessId: assignedBusinessId || '',
      maxHours: maxHours === 'Indefinido' ? 'Indefinido' : (Number(maxHours) || 40),
      preferredShift: preferredShift || 'Indiferente',
      note: (note || '').trim(),
      active: true,
      createdAt: new Date().toISOString(),
      createdByAdminId: req.auth.user.id
    };

    data.auth.registrationCodes.unshift(code);
    await saveData(data);
    res.status(201).json(code);
  } catch (error) {
    res.status(500).json({ error: 'No se pudo generar el código de registro' });
  }
});

app.post('/api/employees/:id/preferences', requireAuth(), async (req, res) => {
  try {
    const { id } = req.params;
    const { preferredShift, availability } = req.body;
    const data = req.auth.data;

    if (req.auth.session.role === 'employee' && req.auth.user.id !== id) {
      return res.status(403).json({ error: 'No puedes modificar las preferencias de otro empleado' });
    }

    const empIndex = data.employees.findIndex(employee => employee.id === id);
    if (empIndex === -1) {
      return res.status(404).json({ error: 'Empleado no encontrado' });
    }

    data.employees[empIndex].preferredShift = preferredShift;
    data.employees[empIndex].availability = availability;

    await saveData(data);
    res.json({
      message: 'Tus preferencias han sido guardadas correctamente',
      employee: data.employees[empIndex]
    });
  } catch (error) {
    res.status(500).json({ error: 'Error al guardar las preferencias del empleado' });
  }
});

app.get('/api/employee/portal', requireAuth('employee'), async (req, res) => {
  try {
    const employee = req.auth.user;
    const data = req.auth.data;

    res.json({
      employee,
      assignments: data.assignments[employee.id] || createWeekAssignments(),
      config: {
        venueName: data.config.venueName,
        businesses: data.config.businesses,
        shifts: data.config.shifts
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'No se pudo cargar el portal del empleado' });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(frontendPath, 'index.html'));
});

app.listen(PORT, () => {
  console.log('\n======================================================');
  console.log('SERVIDOR SHIFTLY ACTIVO Y ESCUCHANDO');
  console.log('======================================================');
  console.log(`Local:            http://localhost:${PORT}`);
  console.log(`Acceso movil:     http://[IP_DE_TU_PC]:${PORT}`);
  console.log('======================================================\n');
});
