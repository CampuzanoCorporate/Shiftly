import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = process.env.SHIFTLY_DATA_DIR
  ? path.resolve(process.env.SHIFTLY_DATA_DIR)
  : __dirname;
const dbPath = process.env.SHIFTLY_DB_PATH
  ? path.resolve(process.env.SHIFTLY_DB_PATH)
  : path.resolve(dataDir, 'database.json');

const defaultLicenseKeys = [
  { key: 'SHIFTLY-START-2026', label: 'Licencia demo inicial', active: true, usedBy: null },
  { key: 'SHIFTLY-BUSINESS-2026', label: 'Licencia negocio anual', active: true, usedBy: null },
  { key: 'SHIFTLY-PRO-2026', label: 'Licencia pro anual', active: true, usedBy: null }
];

const defaultData = {
  config: {
    venueName: 'Grupo Gastronómico Shiftly',
    roles: ['Camarero', 'Cocina', 'Encargado'],
    businesses: [],
    shifts: {}
  },
  demands: {},
  employees: [],
  assignments: {},
  auth: {
    users: [],
    sessions: [],
    registrationCodes: [],
    licenseKeys: defaultLicenseKeys
  }
};

function createInitialWeekAssignments() {
  return {
    Lunes: 'Descanso',
    Martes: 'Descanso',
    Miércoles: 'Descanso',
    Jueves: 'Descanso',
    Viernes: 'Descanso',
    Sábado: 'Descanso',
    Domingo: 'Descanso'
  };
}

function normalizeEmployee(employee = {}) {
  return {
    ...employee,
    role: employee.role || 'Camarero',
    maxHours: employee.maxHours ?? 40,
    preferredShift: employee.preferredShift || 'Indiferente',
    assignedBusinessId: employee.assignedBusinessId || '',
    availability: employee.availability || {}
  };
}

function ensureDataShape(raw = {}) {
  const data = {
    ...defaultData,
    ...raw,
    config: {
      ...defaultData.config,
      ...(raw.config || {})
    },
    auth: {
      ...defaultData.auth,
      ...(raw.auth || {})
    }
  };

  if (!Array.isArray(data.config.roles) || data.config.roles.length === 0) {
    data.config.roles = [...defaultData.config.roles];
  }

  if (!Array.isArray(data.config.businesses)) {
    data.config.businesses = [];
  }

  if (!data.config.shifts || typeof data.config.shifts !== 'object' || Array.isArray(data.config.shifts)) {
    data.config.shifts = {};
  }

  if (!data.demands || typeof data.demands !== 'object' || Array.isArray(data.demands)) {
    data.demands = {};
  }

  if (!Array.isArray(data.employees)) {
    data.employees = [];
  }
  data.employees = data.employees.map(normalizeEmployee);

  if (!data.assignments || typeof data.assignments !== 'object' || Array.isArray(data.assignments)) {
    data.assignments = {};
  }

  data.employees.forEach(employee => {
    if (!data.assignments[employee.id]) {
      data.assignments[employee.id] = createInitialWeekAssignments();
    }
  });

  if (!Array.isArray(data.auth.users)) {
    data.auth.users = [];
  }

  if (!Array.isArray(data.auth.sessions)) {
    data.auth.sessions = [];
  }

  if (!Array.isArray(data.auth.registrationCodes)) {
    data.auth.registrationCodes = [];
  }

  if (!Array.isArray(data.auth.licenseKeys) || data.auth.licenseKeys.length === 0) {
    data.auth.licenseKeys = [...defaultLicenseKeys];
  }

  return data;
}

export function createWeekAssignments() {
  return createInitialWeekAssignments();
}

export async function getData() {
  try {
    const raw = await fs.readFile(dbPath, 'utf8');
    return ensureDataShape(JSON.parse(raw));
  } catch (error) {
    if (error.code === 'ENOENT') {
      await saveData(defaultData);
      return ensureDataShape(defaultData);
    }
    console.error('Error al leer la base de datos JSON:', error);
    throw error;
  }
}

export async function saveData(data) {
  try {
    const normalized = ensureDataShape(data);
    await fs.writeFile(dbPath, JSON.stringify(normalized, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error('Error al escribir en la base de datos JSON:', error);
    throw error;
  }
}
