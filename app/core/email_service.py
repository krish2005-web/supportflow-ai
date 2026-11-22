
import smtplib
import ssl
from email.message import EmailMessage

from app.core.config import settings


def smtp_configured():
    return bool(
        settings.smtp_host
        and settings.smtp_from_email
        and settings.smtp_username
        and settings.smtp_password
    )


def send_password_reset_otp(to_email: str, otp: str):

    
    if not smtp_configured():
        print(f"OTP for {to_email}: {otp}")
        return False

    
    email = EmailMessage()

    email["Subject"] = f"{settings.app_name} - Password Reset"
    email["From"] = settings.smtp_from_email
    email["To"] = to_email

    
    email.set_content(
        f"""
        Your password reset OTP is: {otp}

        This OTP expires in 5 minutes.

        If you did not request a password reset,
        please ignore this email.
        """
    )

    try:
        
        if settings.smtp_use_tls:
            with smtplib.SMTP(
                settings.smtp_host,
                settings.smtp_port
            ) as server:

                server.starttls(context=ssl.create_default_context())

                server.login(
                    settings.smtp_username,
                    settings.smtp_password
                )

                server.send_message(email)


        else:
            with smtplib.SMTP_SSL(
                settings.smtp_host,
                settings.smtp_port,
                context=ssl.create_default_context()
            ) as server:

                server.login(
                    settings.smtp_username,
                    settings.smtp_password
                )

                server.send_message(email)

        return True

    except Exception as error:
        print("Email sending failed:", error)
        return False
