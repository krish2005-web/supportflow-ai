
from getpass import getpass

from app.core.security import hash_password
from app.db.database import SessionLocal
from app.models.user import User


def main():

    
    name = input("Enter agent name: ").strip()
    email = input("Enter agent email: ").strip().lower()
    password = getpass("Enter agent password: ")

    
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

            
            if existing_user.role == "agent":
                existing_user.name = name
                existing_user.password_hash = hash_password(password)

                db.commit()

                print("Agent account updated successfully")

            else:
                print("This email belongs to another account")

            return

        
        new_agent = User(
            name=name,
            email=email,
            password_hash=hash_password(password),
            role="agent"
        )

        db.add(new_agent)
        db.commit()

        print("Agent account created successfully")

    except Exception:
        db.rollback()
        raise

    finally:
        db.close()


if __name__ == "__main__":
    main()
