"""Admin routes — keep this file simple and easy to read."""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.core.dependencies import require_role
from app.core.security import hash_password
from app.db.database import get_db
from app.models.ai_analysis import TicketAIAnalysis
from app.models.ticket import Ticket
from app.models.ticket_message import TicketMessage
from app.models.user import User
from app.schemas.admin import AdminRoleUpdate, AdminTicketAssignment, AdminUserCreate
from app.schemas.ticket import TicketAIAnalysisResponse, TicketResponse
from app.schemas.user import UserResponse

router = APIRouter(prefix="/admin", tags=["Administration"])


def get_admin(current_user=Depends(require_role("admin"))):
    return current_user


@router.get("/dashboard")
def admin_dashboard(db: Session = Depends(get_db), current_user=Depends(get_admin)):
    total_users = db.query(User).count()
    total_customers = db.query(User).filter(User.role == "customer").count()
    total_agents = db.query(User).filter(User.role == "agent").count()
    total_admins = db.query(User).filter(User.role == "admin").count()
    total_tickets = db.query(Ticket).count()
    unassigned = db.query(Ticket).filter(Ticket.assigned_to == None).count()
    total_analyses = db.query(TicketAIAnalysis).count()

    
    status_counts = {}
    for row in db.query(Ticket.status).all():
        status = row[0]
        status_counts[status] = status_counts.get(status, 0) + 1

    return {
        "total_users": total_users,
        "total_customers": total_customers,
        "total_agents": total_agents,
        "total_admins": total_admins,
        "total_tickets": total_tickets,
        "unassigned_tickets": unassigned,
        "total_analyses": total_analyses,
        "tickets_by_status": status_counts,
    }


@router.get("/tickets")
def admin_list_tickets(
    page: int = Query(1, ge=1),
    limit: int = Query(100, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user=Depends(get_admin),
):
    """List all tickets with customer and agent names for the admin table."""
    offset = (page - 1) * limit
    tickets = (
        db.query(Ticket)
        .order_by(Ticket.id.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )

    result = []
    for t in tickets:
        customer = db.query(User).filter(User.id == t.customer_id).first()
        agent = None
        if t.assigned_to is not None:
            agent = db.query(User).filter(User.id == t.assigned_to).first()

        result.append(
            {
                "id": t.id,
                "title": t.title,
                "description": t.description,
                "status": t.status,
                "priority": t.priority,
                "customer_id": t.customer_id,
                "customer_name": customer.name if customer else None,
                "customer_email": customer.email if customer else None,
                "assigned_to": t.assigned_to,
                "agent_name": agent.name if agent else None,
                "agent_email": agent.email if agent else None,
                "created_at": t.created_at,
                "updated_at": t.updated_at,
            }
        )
    return result


@router.get("/users")
def admin_list_users(
    page: int = Query(1, ge=1),
    limit: int = Query(100, ge=1, le=100),
    role: str | None = Query(None),
    db: Session = Depends(get_db),
    current_user=Depends(get_admin),
):
    """List users. Optional role filter: customer | agent | admin."""
    query = db.query(User)
    if role in ("customer", "agent", "admin"):
        query = query.filter(User.role == role)

    offset = (page - 1) * limit
    users = query.order_by(User.id.desc()).offset(offset).limit(limit).all()

    result = []
    for u in users:
        result.append(
            {
                "id": u.id,
                "name": u.name,
                "email": u.email,
                "role": u.role,
                "created_at": u.created_at,
            }
        )
    return result


@router.post("/users", status_code=201)
def admin_create_user(
    user_data: AdminUserCreate,
    db: Session = Depends(get_db),
    current_user=Depends(get_admin),
):
    """Admin creates a customer or agent account."""
    email = user_data.email.lower().strip()
    existing = db.query(User).filter(User.email == email).first()
    if existing:
        raise HTTPException(status_code=409, detail="Email is already registered")

    user = User(
        name=user_data.name.strip(),
        email=email,
        password_hash=hash_password(user_data.password),
        role=user_data.role,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    return {
        "id": user.id,
        "name": user.name,
        "email": user.email,
        "role": user.role,
        "created_at": user.created_at,
    }


@router.patch("/users/{user_id}/role")
def admin_update_role(
    user_id: int,
    role_data: AdminRoleUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(get_admin),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.role == "admin":
        raise HTTPException(status_code=403, detail="Administrator roles are protected")

    user.role = role_data.role
    db.commit()
    db.refresh(user)

    return {
        "id": user.id,
        "name": user.name,
        "email": user.email,
        "role": user.role,
        "created_at": user.created_at,
    }


@router.patch("/tickets/{ticket_id}/assign")
def admin_assign_ticket(
    ticket_id: int,
    assignment: AdminTicketAssignment,
    db: Session = Depends(get_db),
    current_user=Depends(get_admin),
):
    ticket = db.query(Ticket).filter(Ticket.id == ticket_id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")

    agent = (
        db.query(User)
        .filter(User.id == assignment.agent_id, User.role == "agent")
        .first()
    )
    if not agent:
        raise HTTPException(status_code=404, detail="Support agent not found")

    ticket.assigned_to = agent.id
    db.commit()
    db.refresh(ticket)

    return {
        "id": ticket.id,
        "title": ticket.title,
        "status": ticket.status,
        "priority": ticket.priority,
        "customer_id": ticket.customer_id,
        "assigned_to": ticket.assigned_to,
        "agent_name": agent.name,
    }


@router.get("/analyses")
def admin_list_analyses(
    page: int = Query(1, ge=1),
    limit: int = Query(100, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user=Depends(get_admin),
):
    offset = (page - 1) * limit
    rows = (
        db.query(TicketAIAnalysis)
        .order_by(TicketAIAnalysis.id.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )

    result = []
    for a in rows:
        result.append(
            {
                "id": a.id,
                "ticket_id": a.ticket_id,
                "category": a.category,
                "suggested_priority": a.suggested_priority,
                "summary": a.summary,
                "suggested_reply": a.suggested_reply,
                "created_at": a.created_at,
                "approved_by": a.approved_by,
                "approved_at": a.approved_at,
                "approved_reply": a.approved_reply,
                "reply_approved_by": a.reply_approved_by,
                "reply_approved_at": a.reply_approved_at,
                "sources": a.sources or [],
            }
        )
    return result


@router.delete("/tickets/{ticket_id}")
def admin_delete_ticket(
    ticket_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_admin),
):
    """Delete a ticket and its dependent AI analyses and conversation messages."""
    ticket = db.query(Ticket).filter(Ticket.id == ticket_id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")

    try:
        analysis_count = db.query(TicketAIAnalysis).filter(
            TicketAIAnalysis.ticket_id == ticket_id
        ).count()
        message_count = db.query(TicketMessage).filter(
            TicketMessage.ticket_id == ticket_id
        ).count()

        
        db.query(TicketAIAnalysis).filter(
            TicketAIAnalysis.ticket_id == ticket_id
        ).delete(synchronize_session=False)
        db.query(TicketMessage).filter(
            TicketMessage.ticket_id == ticket_id
        ).delete(synchronize_session=False)
        db.delete(ticket)
        db.commit()
    except Exception as exc:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Ticket could not be deleted because another record still references it.",
        ) from exc

    return {
        "message": "Ticket and its related messages and AI analyses were deleted.",
        "ticket_id": ticket_id,
        "deleted_analyses": analysis_count,
        "deleted_messages": message_count,
    }


@router.delete("/users/{user_id}")
def admin_delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_admin),
):
    """Delete a customer or agent and safely clean up all dependent records.

    Tickets owned by the user are deleted with their messages and AI analyses.
    Tickets assigned to the user are retained but become unassigned. Approval
    attribution and messages authored by the user are removed before deleting
    the user row. Administrator accounts and the current admin are protected.
    """
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.id == current_user.id:
        raise HTTPException(status_code=400, detail="You cannot delete your own account")
    if user.role == "admin":
        raise HTTPException(status_code=403, detail="Administrator accounts cannot be deleted")

    try:
      
        owned_ticket_ids = [
            row[0]
            for row in db.query(Ticket.id).filter(Ticket.customer_id == user_id).all()
        ]

        unassigned_count = db.query(Ticket).filter(
            Ticket.assigned_to == user_id
        ).update({Ticket.assigned_to: None}, synchronize_session=False)

        
        approval_rows = db.query(TicketAIAnalysis).filter(
            or_(
                TicketAIAnalysis.approved_by == user_id,
                TicketAIAnalysis.reply_approved_by == user_id,
            )
        ).all()
        for analysis in approval_rows:
            if analysis.approved_by == user_id:
                analysis.approved_by = None
                analysis.approved_at = None
            if analysis.reply_approved_by == user_id:
                analysis.reply_approved_by = None
                analysis.reply_approved_at = None

        
        message_filter = TicketMessage.sender_id == user_id
        if owned_ticket_ids:
            message_filter = or_(
                TicketMessage.sender_id == user_id,
                TicketMessage.ticket_id.in_(owned_ticket_ids),
            )
        deleted_message_count = db.query(TicketMessage).filter(message_filter).count()
        db.query(TicketMessage).filter(message_filter).delete(synchronize_session=False)

        deleted_analysis_count = 0
        deleted_ticket_count = len(owned_ticket_ids)
        if owned_ticket_ids:
            deleted_analysis_count = db.query(TicketAIAnalysis).filter(
                TicketAIAnalysis.ticket_id.in_(owned_ticket_ids)
            ).count()
            db.query(TicketAIAnalysis).filter(
                TicketAIAnalysis.ticket_id.in_(owned_ticket_ids)
            ).delete(synchronize_session=False)
            db.query(Ticket).filter(
                Ticket.id.in_(owned_ticket_ids)
            ).delete(synchronize_session=False)

        db.delete(user)
        db.commit()
    except Exception as exc:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Account could not be deleted because related data is still linked. No records were changed.",
        ) from exc

    return {
        "message": "Account deleted successfully.",
        "id": user_id,
        "deleted_tickets": deleted_ticket_count,
        "deleted_analyses": deleted_analysis_count,
        "deleted_messages": deleted_message_count,
        "tickets_returned_to_queue": unassigned_count,
    }
