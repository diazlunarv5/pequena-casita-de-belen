
const supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);

// Este UID solo controla qué interfaz se muestra.
// Los permisos reales siguen dependiendo de las políticas RLS.
const ADMIN_UID = "6f492f7c-8f85-49b9-90cd-271fe669bbf8";
const BUCKET = "fotos-rincon-papas";

const loginPanel = document.getElementById("login-panel");
const contentPanel = document.getElementById("content-panel");
const adminPanel = document.getElementById("admin-panel");
const loginForm = document.getElementById("login-form");
const loginStatus = document.getElementById("login-status");
const adminStatus = document.getElementById("admin-status");
const activitiesList = document.getElementById("activities-list");

let currentUser = null;

function showMessage(element, message) {
  element.textContent = message;
}

function safeDate(date) {
  if (!date) return "Fecha por confirmar";
  const parsed = new Date(date + "T12:00:00");
  return Number.isNaN(parsed.getTime())
    ? "Fecha por confirmar"
    : parsed.toLocaleDateString("es-MX", {
        day: "numeric",
        month: "long",
        year: "numeric"
      });
}

async function refreshSession() {
  const { data, error } = await supabaseClient.auth.getSession();

  if (error) {
    showMessage(loginStatus, "No se pudo comprobar la sesión.");
    return;
  }

  await updateView(data.session?.user ?? null);
}

async function updateView(user) {
  currentUser = user;
  loginPanel.hidden = Boolean(user);
  contentPanel.hidden = !user;
  adminPanel.hidden = !user || user.id !== ADMIN_UID;

  if (!user) return;

  document.getElementById("welcome-message").textContent =
    user.id === ADMIN_UID
      ? "Bienvenida, administradora. Aquí puedes publicar novedades."
      : "¡Bienvenidos al Rincón de Papás!";

  await loadActivities();
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitButton = event.submitter;
if (submitButton) submitButton.disabled = true;
  showMessage(loginStatus, "Verificando acceso...");

  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;

  const { data, error } = await supabaseClient.auth.signInWithPassword({
    email,
    password
  });

  if (error) {
    showMessage(loginStatus, "No pudimos iniciar sesión. Verifica tus datos.");
    return;
  }

  loginForm.reset();
  showMessage(loginStatus, "");
  await updateView(data.user);
});

document.getElementById("logout-button").addEventListener("click", async () => {
  const { error } = await supabaseClient.auth.signOut();

  if (error) {
    alert("No se pudo cerrar la sesión. Inténtalo nuevamente.");
    return;
  }

  await updateView(null);
});

let loadingActivities = false;
async function loadActivities() {
  if (loadingActivities) return;
  loadingActivities = true;

  console.count("loadActivities ejecutada");
  activitiesList.textContent = "Cargando actividades...";

  const { data: activities, error } = await supabaseClient
    .from("actividades")
    .select("id, titulo, descripcion, fecha_evento, imagen_url, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    activitiesList.textContent = "No se pudieron cargar las actividades.";
    return;
  }

  activitiesList.replaceChildren();
activitiesList.dataset.rendered = "true";
  if (!activities.length) {
    activitiesList.textContent = "Todavía no hay actividades publicadas.";
    return;
  }

  for (const activity of activities) {
    const card = document.createElement("article");
    card.className = "activity-card";

    const title = document.createElement("h3");
    title.textContent = activity.titulo;

    const date = document.createElement("time");
    date.textContent = safeDate(activity.fecha_evento);

    const description = document.createElement("p");
    description.textContent = activity.descripcion;

    card.append(title, date, description);

    // Obtener las fotografías asociadas a esta actividad.
    const { data: photos, error: photosError } = await supabaseClient
      .from("actividad_fotos")
      .select("id, archivo_path")
      .eq("actividad_id", activity.id)
      .order("created_at", { ascending: true });

    if (!photosError && photos?.length) {
      const gallery = document.createElement("div");
      gallery.className = "activity-gallery";

      for (const photo of photos) {
        const { data: signed, error: signedError } =
          await supabaseClient.storage
            .from(BUCKET)
            .createSignedUrl(photo.archivo_path, 300);

        if (signedError || !signed?.signedUrl) continue;

        const img = document.createElement("img");
        img.src = signed.signedUrl;
        img.alt = `Fotografía de ${activity.titulo}`;
        img.loading = "lazy";
        gallery.append(img);
      }

      if (gallery.childElementCount) card.append(gallery);
    }

    // Mostrar imágenes antiguas guardadas en imagen_url, si las hay.
    if (activity.imagen_url) {
      const { data: signed, error: signedError } =
        await supabaseClient.storage
          .from(BUCKET)
          .createSignedUrl(activity.imagen_url, 300);

      if (!signedError && signed?.signedUrl) {
        const img = document.createElement("img");
        img.src = signed.signedUrl;
        img.alt = `Fotografía de ${activity.titulo}`;
        img.loading = "lazy";
        card.append(img);
      }
    }

    if (currentUser?.id === ADMIN_UID) {
      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.textContent = "Eliminar actividad";
      deleteButton.addEventListener("click", () => deleteActivity(activity));
      card.append(deleteButton);
    }

    activitiesList.append(card);
  }
loadingActivities = false;
}


document.getElementById("activity-form").addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!currentUser || currentUser.id !== ADMIN_UID) {
    showMessage(adminStatus, "Solo la administradora puede publicar.");
    return;
  }

  const title = document.getElementById("activity-title").value.trim();
  const description =
    document.getElementById("activity-description").value.trim();
  const date = document.getElementById("activity-date").value || null;
  const files = Array.from(
    document.getElementById("activity-images").files
  );

  if (!title || !description) {
    showMessage(adminStatus, "Completa el título y la descripción.");
    return;
  }

  const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
  const maxSize = 5 * 1024 * 1024;

  if (files.some(file => !allowedTypes.includes(file.type))) {
    showMessage(adminStatus, "Usa solamente imágenes JPG, PNG o WebP.");
    return;
  }

  if (files.some(file => file.size > maxSize)) {
    showMessage(adminStatus, "Cada fotografía debe pesar como máximo 5 MB.");
    return;
  }

  if (files.length > 20) {
    showMessage(adminStatus, "Puedes subir hasta 20 fotografías por actividad.");
    return;
  }

  showMessage(adminStatus, "Guardando actividad y fotografías...");


const { data: activity, error: activityError } =
  await supabaseClient
    .from("actividades")
    .insert({
      titulo: title,
      descripcion: description,
      fecha_evento: date
    })
    .select("id")
    .single();


  if (activityError) {
    showMessage(adminStatus, "No se pudo guardar la actividad.");
    return;
  }

  const uploadedPaths = [];

  for (const file of files) {
    const extension = {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp"
    }[file.type];

    const path = `${crypto.randomUUID()}.${extension}`;

    const { error: uploadError } = await supabaseClient.storage
      .from(BUCKET)
      .upload(path, file, {
        contentType: file.type,
        upsert: false
      });

    if (uploadError) {
      showMessage(
        adminStatus,
        "La actividad se guardó, pero falló una fotografía. No publiques más hasta revisar el error."
      );
      return;
    }

    uploadedPaths.push(path);
  }

  if (uploadedPaths.length) {
    const photoRows = uploadedPaths.map(path => ({
      actividad_id: activity.id,
      archivo_path: path
    }));

    const { error: photosError } = await supabaseClient
      .from("actividad_fotos")
      .insert(photoRows);

    if (photosError) {
      showMessage(
        adminStatus,
        "La actividad y las imágenes se guardaron, pero no se pudo completar la galería. Revisa las políticas RLS."
      );
      return;
    }
  }

  event.target.reset();
showMessage(adminStatus, "¡Actividad publicada con todas sus fotografías!");
await loadActivities();

if (submitButton) submitButton.disabled = false;
});


async function deleteActivity(activity) {
  if (!currentUser || currentUser.id !== ADMIN_UID) return;

  if (!confirm(`¿Deseas eliminar "${activity.titulo}"?`)) return;

  const { error } = await supabaseClient
    .from("actividades")
    .delete()
    .eq("id", activity.id);

  if (error) {
    alert("No se pudo eliminar la actividad.");
    return;
  }

  if (activity.imagen_url) {
    const { error: storageError } = await supabaseClient.storage
      .from(BUCKET)
      .remove([activity.imagen_url]);

    if (storageError) {
      alert("La actividad se eliminó, pero no se pudo eliminar su fotografía.");
    }
  }

  await loadActivities();
}


supabaseClient.auth.onAuthStateChange((_event, session) => {
  currentUser = session?.user ?? null;

  loginPanel.hidden = Boolean(currentUser);
  contentPanel.hidden = !currentUser;
  adminPanel.hidden = !currentUser || currentUser.id !== ADMIN_UID;

  if (currentUser) {
    document.getElementById("welcome-message").textContent =
      currentUser.id === ADMIN_UID
        ? "Bienvenida, administradora. Aquí puedes publicar novedades."
        : "¡Bienvenidos al Rincón de Papás!";

    loadActivities();
  }
});

refreshSession();

