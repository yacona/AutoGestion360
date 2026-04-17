/* =========================================================
   MAIN — bootstrap de la SPA
   Registra todos los event listeners y arranca la app.
   Depende de: todos los módulos core y de feature.
   ========================================================= */

// Forzar mayúsculas en inputs de texto y textarea
document.addEventListener("input", (e) => {
  if (e.target.tagName === "INPUT" && e.target.type === "text") {
    e.target.value = e.target.value.toUpperCase();
  }
  if (e.target.tagName === "TEXTAREA") {
    e.target.value = e.target.value.toUpperCase();
  }
});

document.addEventListener("DOMContentLoaded", async () => {
  initTheme();

  // ── Autenticación ───────────────────────────────────────
  document.getElementById("login-form")?.addEventListener("submit", handleLogin);
  document.getElementById("btn-logout")?.addEventListener("click", logout);

  // ── Navegación sidebar ──────────────────────────────────
  document.querySelectorAll(".nav-link").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.classList.contains("module-locked")) {
        showModuleBlockedMessage(btn.dataset.licenseModule);
        return;
      }
      changeView(btn.dataset.view);
    });
  });

  initModuleCatalog();

  // ── Parqueadero ─────────────────────────────────────────
  document.getElementById("form-parqueadero-entrada")?.addEventListener("submit", handleEntradaParqueadero);
  document.getElementById("form-parqueadero-mensualidad")?.addEventListener("submit", handleNuevaMensualidadParqueadero);
  document.getElementById("btn-pq-ingreso-ocasional")?.addEventListener("click", () => seleccionarFlujoParqueadero("ocasional"));
  document.getElementById("btn-pq-ingreso-dia")?.addEventListener("click", () => seleccionarFlujoParqueadero("dia"));
  document.getElementById("btn-pq-ingreso-mensualidad")?.addEventListener("click", () => seleccionarFlujoParqueadero("mensualidad"));
  document.getElementById("btn-pq-alta-mensualidad")?.addEventListener("click", () => seleccionarFlujoParqueadero("alta"));
  document.getElementById("pq-tbody")?.addEventListener("click", handleSalidaClick);
  document.getElementById("pq-historial-buscar")?.addEventListener("input", () => cargarHistorialParqueadero());

  // ── Lavadero ────────────────────────────────────────────
  document.getElementById("form-lavadero-nueva")?.addEventListener("submit", handleNovaLavado);
  document.getElementById("lav-buscar")?.addEventListener("input", () => cargarOrdeneesLavadero());
  document.getElementById("lav-historial-buscar")?.addEventListener("input", () => cargarOrdeneesLavadero());

  // ── Taller ──────────────────────────────────────────────
  document.getElementById("form-taller-nueva")?.addEventListener("submit", handleNuevaOrdenTaller);
  document.getElementById("tal-historial-buscar")?.addEventListener("input", () => cargarOrdensTaller());

  // ── Clientes ────────────────────────────────────────────
  document.getElementById("form-cliente-nuevo")?.addEventListener("submit", handleNuevoCliente);
  document.getElementById("cli-buscar")?.addEventListener("input", filtrarClientes);
  document.getElementById("cli-perfil-close")?.addEventListener("click", cerrarPerfilCliente);
  document.getElementById("cli-action-editar")?.addEventListener("click", () => abrirClienteActionPanel("editar"));
  document.getElementById("cli-action-vehiculo")?.addEventListener("click", () => abrirClienteActionPanel("vehiculo"));
  document.getElementById("cli-action-mensualidad")?.addEventListener("click", () => abrirClienteActionPanel("mensualidad"));
  document.getElementById("form-cli-editar")?.addEventListener("submit", handleEditarCliente360);
  document.getElementById("form-cli-vehiculo")?.addEventListener("submit", handleAgregarVehiculoCliente360);
  document.getElementById("form-cli-mensualidad")?.addEventListener("submit", handleCrearMensualidadCliente360);
  document.getElementById("cli-men-vehiculo")?.addEventListener("change", sincronizarVehiculoMensualidadCliente);
  document.getElementById("cli-recibo-cliente")?.addEventListener("click", abrirReciboCliente360);
  document.getElementById("veh360-close")?.addEventListener("click", cerrarVehiculo360);
  document.getElementById("veh360-action-parqueadero")?.addEventListener("click", iniciarIngresoVehiculo360);
  document.getElementById("veh360-action-lavadero")?.addEventListener("click", iniciarLavadoVehiculo360);
  document.getElementById("veh360-action-taller")?.addEventListener("click", iniciarTallerVehiculo360);
  document.getElementById("veh360-action-mensualidad")?.addEventListener("click", iniciarMensualidadVehiculo360);
  document.getElementById("veh360-action-recibo")?.addEventListener("click", abrirReciboVehiculo360);
  document.querySelectorAll("[data-cli-action-cancel]").forEach((btn) => {
    btn.addEventListener("click", cerrarClienteActionPanels);
  });

  // ── Empleados ───────────────────────────────────────────
  document.getElementById("form-empleado-nuevo")?.addEventListener("submit", handleNuevoEmpleado);
  document.getElementById("emp-filtro-rol")?.addEventListener("change", filtrarEmpleadosPorRol);

  // ── Reportes ────────────────────────────────────────────
  document.getElementById("form-rep-filtro")?.addEventListener("submit", handleGenerarReportes);
  document.getElementById("btn-rep-hoy")?.addEventListener("click", () => setReportRangeAndGenerate(0));
  document.getElementById("btn-rep-7")?.addEventListener("click", () => setReportRangeAndGenerate(6));
  document.getElementById("btn-rep-30")?.addEventListener("click", () => setReportRangeAndGenerate(30));
  document.getElementById("btn-rep-exportar")?.addEventListener("click", exportReportesCSV);
  document.getElementById("form-caja-arqueo")?.addEventListener("submit", handleGuardarArqueoCaja);
  document.getElementById("rep-caja-efectivo-contado")?.addEventListener("input", actualizarDiferenciaArqueo);

  // ── Empresas (superadmin) ───────────────────────────────
  document.getElementById("form-empresa-admin")?.addEventListener("submit", handleGuardarEmpresaAdmin);
  document.getElementById("empresas-buscar")?.addEventListener("input", renderEmpresasTable);
  document.getElementById("btn-empresa-cancelar-edicion")?.addEventListener("click", resetEmpresaAdminForm);
  document.getElementById("form-licencia-empresa")?.addEventListener("submit", handleAsignarLicenciaEmpresa);
  document.getElementById("licencia-plan-id")?.addEventListener("change", renderLicenciaPlanModulos);
  document.getElementById("licencia-empresa-id")?.addEventListener("change", () => syncLicenciaEmpresaForm());
  document.getElementById("form-suscripcion-saas")?.addEventListener("submit", handleGuardarSuscripcionSaas);
  document.getElementById("suscripcion-empresa-id")?.addEventListener("change", () => syncSuscripcionSaasForm());
  document.getElementById("suscripcion-plan-id")?.addEventListener("change", () => {
    const licencia = getLicenciaById(document.getElementById("suscripcion-plan-id")?.value);
    if (licencia) document.getElementById("suscripcion-precio-plan").value = String(Math.round(Number(licencia.precio || 0)));
  });
  document.getElementById("btn-suscripcion-renovar")?.addEventListener("click", handleRenovarSuscripcionSaas);
  document.getElementById("btn-suscripcion-suspender")?.addEventListener("click", () => handleCambiarEstadoSuscripcionSaas("SUSPENDIDA"));
  document.getElementById("btn-suscripcion-cancelar")?.addEventListener("click", () => handleCambiarEstadoSuscripcionSaas("CANCELADA"));
  document.getElementById("form-factura-saas")?.addEventListener("submit", handleRegistrarFacturaSaas);

  // ── Usuarios ────────────────────────────────────────────
  document.getElementById("form-usuario-sistema")?.addEventListener("submit", handleGuardarUsuarioSistema);
  document.getElementById("usuarios-buscar")?.addEventListener("input", renderUsuariosSistemaTable);
  document.getElementById("btn-usuario-cancelar-edicion")?.addEventListener("click", resetUsuarioSistemaForm);

  // ── Configuración ───────────────────────────────────────
  document.getElementById("form-empresa")?.addEventListener("submit", handleActualizarEmpresa);
  document.getElementById("btn-ver-licencias")?.addEventListener("click", handleVerLicencias);
  document.getElementById("btn-asignar-licencia")?.addEventListener("click", handleAsignarLicencia);
  document.getElementById("btn-gestionar-licencia")?.addEventListener("click", handleGestionarPlanActual);
  document.getElementById("btn-renovar-licencia")?.addEventListener("click", handleGestionarPlanActual);
  document.getElementById("btn-notificar-vencimientos")?.addEventListener("click", handleNotificarVencimientos);
  document.getElementById("empresa-logo-file")?.addEventListener("change", handleLogoFileChange);
  document.getElementById("form-parqueadero-config")?.addEventListener("submit", handleGuardarParqueaderoConfig);
  document.getElementById("btn-toggle-parqueadero-config")?.addEventListener("click", toggleParqueaderoConfig);

  document.querySelectorAll(".config-tab").forEach((btn) => {
    btn.addEventListener("click", () => setConfigTab(btn.dataset.configTab));
  });

  document.querySelectorAll("[data-theme-option]").forEach((btn) => {
    btn.addEventListener("click", () => applyTheme(btn.dataset.themeOption));
  });

  // ── Dashboard ───────────────────────────────────────────
  document.getElementById("dash-fecha")?.addEventListener("change", loadDashboard);
  document.getElementById("btn-refresh-alertas")?.addEventListener("click", cargarAlertasInteligentes);
  document.getElementById("dash-alertas-list")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-alert-action]");
    if (!button) return;
    abrirAccionAlerta(button.dataset.alertModule, button.dataset.alertReferenceType);
  });
  document.getElementById("btn-dash-hoy")?.addEventListener("click", () => {
    const input = document.getElementById("dash-fecha");
    if (input) input.value = formatDateParam(new Date());
    loadDashboard();
  });

  // ── Cobro modal ─────────────────────────────────────────
  document.getElementById("cobro-metodo-pago")?.addEventListener("change", () => {
    actualizarCamposPagoServicio("cobro-metodo-pago", "cobro-referencia-group", "cobro-detalle-pago-group");
  });
  document.getElementById("btn-confirmar-cobro-servicio")?.addEventListener("click", confirmarCobroServicio);
  document.getElementById("btn-cancelar-cobro-servicio")?.addEventListener("click", cerrarModalCobroServicio);

  // ── Arranque ────────────────────────────────────────────
  const token = localStorage.getItem(STORAGE.TOKEN);
  if (token) {
    showMainView();
    await initAfterLogin();
  } else {
    showLoginView();
  }
});
