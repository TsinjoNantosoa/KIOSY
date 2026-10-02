import smtplib
from email.message import EmailMessage

from app.core.config import Settings


class EmailSender:
    def __init__(self, settings: Settings):
        self.settings = settings

    def send_password_reset(self, recipient: str, token: str) -> None:
        if self.settings.email_mode == "disabled":
            raise RuntimeError("Email delivery is disabled")
        reset_url = f"{self.settings.frontend_origins[0]}/mot-de-passe/reinitialiser?token={token}"
        message = EmailMessage()
        message["Subject"] = "Réinitialisation de votre mot de passe Kiosy"
        message["From"] = self.settings.smtp_from
        message["To"] = recipient
        message.set_content(
            "Une réinitialisation a été demandée pour votre compte Kiosy.\n\n"
            f"Lien valable 30 minutes : {reset_url}\n\n"
            "Ignorez ce message si vous n'êtes pas à l'origine de la demande."
        )
        with smtplib.SMTP(self.settings.smtp_host, self.settings.smtp_port, timeout=10) as client:
            if self.settings.smtp_starttls:
                client.starttls()
            if self.settings.smtp_username and self.settings.smtp_password:
                client.login(self.settings.smtp_username, self.settings.smtp_password)
            client.send_message(message)
