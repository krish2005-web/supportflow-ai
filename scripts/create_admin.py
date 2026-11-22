
from getpass import getpass

from app.core.security import hash_password
from app.db.database import SessionLocal
from app.models.user import User


def main():

    
    name = input("Enter admin name: ").strip()
    email = input("Enter admin email: ").strip().lower()
    password = getpass("Enter admin password: ")

    
    if not name:
        print("Name is required")
        return

    if not email:
        print("Email is required")
        return

    if len(password) < 8:
        print("Password must be at least 8 characters")
        return

    
    db = SessionLocal()

    try:
        
        existing_user = db.query(User).filter(
            User.email == email
        ).first()

        if existing_user:
            print("This email is already registered")
            return

        
        new_admin = User(
            name=name,
            email=email,
            password_hash=hash_password(password),
            role="admin"
        )

        
        db.add(new_admin)
        db.commit()

        print("Admin account created successfully")

    except Exception:
        db.rollback()
        print("Something went wrong while creating admin")
        raise

    finally:
        db.close()


if __name__ == "__main__":
    main()
