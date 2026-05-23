# Shiftly

## Despliegue recomendado

### Frontend en Vercel

El frontend ya está preparado con [vercel.json](/Users/javiercampuzanogarcia/Documents/VisualStudio/Shiftly/vercel.json).

Antes de desplegar en Vercel, cambia esta URL:

```json
"destination": "https://YOUR-BACKEND-URL.com/api/:path*"
```

por la URL real de tu backend en Render, por ejemplo:

```json
"destination": "https://shiftly-backend.onrender.com/api/:path*"
```

### Backend en Render

El backend ya está preparado con [render.yaml](/Users/javiercampuzanogarcia/Documents/VisualStudio/Shiftly/render.yaml).

Pasos:

1. Sube este repositorio a GitHub.
2. En Render, crea un servicio nuevo desde el repo.
3. Render detectará el `render.yaml` y montará el servicio `shiftly-backend`.
4. Cuando termine el deploy, copia la URL pública del servicio.
5. Pega esa URL en `vercel.json` como destino de `/api/:path*`.
6. Despliega el frontend en Vercel.

### Nota importante sobre datos

En el plan gratuito de Render, el sistema de archivos es efímero. Eso significa que `backend/database.json` puede perderse al reiniciar o redesplegar el servicio.

El backend ha quedado preparado para usar una ruta persistente más adelante con estas variables opcionales:

- `SHIFTLY_DATA_DIR`
- `SHIFTLY_DB_PATH`

Si más adelante pasas a un disco persistente o migras a base de datos, no habrá que rehacer toda la app.
