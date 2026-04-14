// utils/email.js
const nodemailer = require('nodemailer');

// Configurar el transporter (ajusta con tus credenciales SMTP)
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: process.env.SMTP_PORT || 587,
  secure: false, // true para 465, false para otros puertos
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

async function enviarNotificacionLicencia(empresaEmail, empresaNombre, licenciaNombre, fechaFin) {
  try {
    const mailOptions = {
      from: process.env.SMTP_USER,
      to: empresaEmail,
      subject: 'Notificación: Licencia próxima a vencer - AutoGestión360',
      html: `
        <h2>Notificación de Licencia</h2>
        <p>Estimado cliente de <strong>${empresaNombre}</strong>,</p>
        <p>Su licencia <strong>${licenciaNombre}</strong> está próxima a vencer.</p>
        <p><strong>Fecha de vencimiento:</strong> ${new Date(fechaFin).toLocaleDateString('es-ES')}</p>
        <p>Por favor, contacte a nuestro equipo de soporte para renovar su licencia y evitar interrupciones en el servicio.</p>
        <p>Atentamente,<br>Equipo de AutoGestión360</p>
      `
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('Correo enviado:', info.messageId);
    return true;
  } catch (error) {
    console.error('Error enviando correo:', error);
    return false;
  }
}

module.exports = { enviarNotificacionLicencia };