from fastapi import APIRouter,Depends,HTTPException,Query
from sqlalchemy.orm import Session
from app.db.database import get_db
from app.models.ticket import Ticket
from app.core.dependencies import get_current_user
from app.schemas.ticket import TicketCreate,TicketResponse,TicketUpdate,TicketStatusUpdate,TicketAnalysis,TicketPriorityApproval,TicketAIAnalysisResponse,TicketReplyApproval,TicketChatRequest,TicketChatResponse,TicketMessageCreate,TicketMessageResponse
from app.core.dependencies import require_role
from sqlalchemy import update
from sqlalchemy.exc import IntegrityError
from sqlalchemy import or_
from app.ai.ai_service import analyze_ticket, answer_ticket_question
from app.models.ai_analysis import TicketAIAnalysis
from app.models.ticket_message import TicketMessage
from sqlalchemy import func
import logging
from datetime import datetime, timezone

router=APIRouter(prefix="/tickets",
                 tags=["Tickets"])

logger = logging.getLogger(__name__)

@router.post("/",response_model=TicketResponse,status_code=201)
def create_ticket(ticket_data:TicketCreate,
                  db:Session=Depends(get_db),
                  current_user=Depends(require_role("customer"))):
    new_ticket=Ticket(
        title=ticket_data.title,
        description=ticket_data.description,
        priority=ticket_data.priority,
        customer_id=current_user.id
)
    db.add(new_ticket)
    try:
        db.commit()
        db.refresh(new_ticket)
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Database integrity error"
        )
    return new_ticket

    

@router.get("/agent-dashboard")
def agent_dashboard(
    db: Session = Depends(get_db),
    current_user=Depends(require_role("agent")),
):
    """Agent home metrics including aging open tickets."""
    from datetime import datetime, timedelta, timezone

    assigned = db.query(Ticket).filter(Ticket.assigned_to == current_user.id).all()
    unassigned_count = (
        db.query(func.count(Ticket.id)).filter(Ticket.assigned_to.is_(None)).scalar() or 0
    )
    active = [t for t in assigned if t.status not in ("resolved", "closed")]
    cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
    aging = []
    for t in active:
        created = t.created_at
        if created is not None and created.tzinfo is None:
            created = created.replace(tzinfo=timezone.utc)
        if created is not None and created < cutoff:
            aging.append(
                {
                    "id": t.id,
                    "title": t.title,
                    "status": t.status,
                    "priority": t.priority,
                    "created_at": t.created_at,
                }
            )
    by_status: dict[str, int] = {}
    for t in assigned:
        by_status[t.status] = by_status.get(t.status, 0) + 1
    return {
        "message": "Welcome Agent",
        "assigned_total": len(assigned),
        "assigned_active": len(active),
        "unassigned_open": unassigned_count,
        "aging_over_24h": aging,
        "tickets_by_status": by_status,
    }

@router.get("/unassigned",response_model=list[TicketResponse])
def unassigned_ticket(current_user=Depends(require_role("agent")),
                      db:Session=Depends(get_db)):
    tickets = db.query(Ticket).filter(
    Ticket.assigned_to.is_(None)
).all()

    return tickets

@router.get("/assigned",response_model=list[TicketResponse])
def assigned_ticket(db:Session=Depends(get_db),
                    current_user=Depends(require_role("agent"))):
    print("Agent ID:", current_user.id)
    print("Agent role:", current_user.role)
    
    ticket=db.query(Ticket).filter(Ticket.assigned_to==current_user.id).all()
    
    return ticket


@router.get("/{ticket_id}", response_model=TicketResponse)
def get_ticket(
    ticket_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    if current_user.role == "agent":
        ticket = db.query(Ticket).filter(
            Ticket.id == ticket_id,
            Ticket.assigned_to == current_user.id
        ).first()

    elif current_user.role == "customer":
        ticket = db.query(Ticket).filter(
            Ticket.id == ticket_id,
            Ticket.customer_id == current_user.id
        ).first()

    else:
        raise HTTPException(
            status_code=403,
            detail="You are not allowed to access tickets"
        )

    if not ticket:
        raise HTTPException(
            status_code=404,
            detail="Ticket not found"
        )

    return ticket
    

@router.get("/",response_model=list[TicketResponse])
def get_all_ticket(db:Session=Depends(get_db),
                   page:int=Query(1,ge=1),
                   limit:int=Query(10,ge=1,le=100),
                   current_user=Depends(require_role("customer"))):
    ticket=db.query(Ticket).filter(Ticket.customer_id==current_user.id)
    
    offset=(page-1)*limit
    ticket=ticket.offset(offset).limit(limit)
    return ticket.all()

@router.patch("/{ticket_id}",response_model=TicketResponse)
def ticket_update(ticket_id:int,
                  ticket_data:TicketUpdate,
                  db:Session=Depends(get_db),
                  current_user=Depends(require_role("customer"))):
    ticket=db.query(Ticket).filter(Ticket.id==ticket_id,Ticket.customer_id==current_user.id).first()
    if not ticket:
        raise HTTPException(
            status_code=404,
            detail="Ticket not found"
        )
    updates=ticket_data.model_dump(exclude_unset=True)
    for field , values in updates.items():
        setattr(ticket,field,values)
    db.commit()
    db.refresh(ticket)
    return ticket

@router.patch("/{ticket_id}/assign", response_model=TicketResponse)
def assign_ticket(
    ticket_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_role("agent"))
):
    stmt = update(Ticket).where(
        Ticket.id == ticket_id,
        Ticket.assigned_to.is_(None)
    ).values(
        assigned_to=current_user.id
    )

    result = db.execute(stmt)

    if result.rowcount == 0:
        ticket = db.query(Ticket).filter(
            Ticket.id == ticket_id
        ).first()

        if not ticket:
            raise HTTPException(
                status_code=404,
                detail="Ticket not found"
            )

        raise HTTPException(
            status_code=409,
            detail="Ticket already assigned"
        )

    db.commit()

    ticket = db.query(Ticket).filter(
        Ticket.id == ticket_id
    ).first()

    return ticket

@router.patch("/{ticket_id}/status",response_model=TicketResponse)
def ticket_status_update(ticket_status:TicketStatusUpdate,
                         ticket_id:int,
                         db:Session=Depends(get_db),
                         current_user=Depends(require_role("agent"))
                         ):
    ticket=db.query(Ticket).filter(Ticket.id==ticket_id,Ticket.assigned_to==current_user.id).first()
    if not ticket:
        raise HTTPException(
            status_code=404,
            detail="Ticket not found"
        )
   

    allowed_transitions = {
    "open": ["in_progress"],
    "in_progress": ["resolved"],
    "resolved": ["closed"],
    "closed": []
}
    
    allowed = allowed_transitions.get(ticket.status, [])
    
    if ticket_status.status not in allowed:
        raise HTTPException(
    status_code=409,
    detail="Invalid ticket status transition"
)

    ticket.status = ticket_status.status

    db.commit()
    db.refresh(ticket)
    return ticket


@router.post(
    "/{ticket_id}/analyze",
    response_model=TicketAIAnalysisResponse
)
def ticket_analyze(
    ticket_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_role("agent"))
):
    ticket = db.query(Ticket).filter(
        Ticket.id == ticket_id,
        Ticket.assigned_to == current_user.id
    ).first()

    if not ticket:
        raise HTTPException(
            status_code=404,
            detail="Ticket not found"
        )

    try:
        ai_result = analyze_ticket(
            title=ticket.title,
            description=ticket.description
        )
    except Exception as exc:
        logger.exception("ResolveIQ ticket analysis failed for ticket %s", ticket_id)
        raise HTTPException(
            status_code=503,
            detail=(
                "ResolveIQ is temporarily unavailable. Check GEMINI_API_KEY, "
                "model access, and knowledge-base indexing, then try again."
            ),
        ) from exc

    analysis_record = TicketAIAnalysis(
        ticket_id=ticket.id,
        category=ai_result.category,
        suggested_priority=ai_result.suggested_priority,
        summary=ai_result.summary,
        suggested_reply=ai_result.suggested_reply,
        sources=ai_result.sources
    )

    db.add(analysis_record)
    db.commit()
    db.refresh(analysis_record)

    return analysis_record


@router.patch("/{ticket_id}/priority",response_model=TicketResponse)
def priority_update(ticket_id:int,
                    priority_update:TicketPriorityApproval,
                    db:Session=Depends(get_db),
                    current_user=Depends(require_role("agent"))):
    ticket=db.query(Ticket).filter(Ticket.id==ticket_id,Ticket.assigned_to==current_user.id).first()
    if not ticket:
        raise HTTPException(
            status_code=404,
            detail="Ticket not found"
        )
    ticket.priority=priority_update.priority

    

    db.commit()
    db.refresh(ticket)

    return ticket

@router.get("/{ticket_id}/analyses",response_model=list[TicketAIAnalysisResponse])
def get_analyses(ticket_id:int,
                 db:Session=Depends(get_db),
                 current_user=Depends(require_role("agent"))):

    ticket = db.query(Ticket).filter(
        Ticket.id == ticket_id,
        Ticket.assigned_to == current_user.id
    ).first()
    if not ticket:
        raise HTTPException(
            status_code=404,
            detail="Ticket not found"
        )
    analyses = db.query(TicketAIAnalysis).filter(
        TicketAIAnalysis.ticket_id == ticket_id
    ).order_by(
        TicketAIAnalysis.created_at.desc()
    ).all()

    return analyses

@router.patch(
    "/{ticket_id}/analyses/{analysis_id}/approve-priority",
    response_model=TicketResponse
)
def approve_priority(ticket_id:int,
                     analysis_id:int,
                     db:Session=Depends(get_db),
                     current_user=Depends(require_role("agent"))):
    ticket=db.query(Ticket).filter(Ticket.id==ticket_id,Ticket.assigned_to==current_user.id).first()
    if not ticket:
        raise HTTPException(status_code=404,
                            detail="Ticket not found")
    
    analysis = db.query(TicketAIAnalysis).filter(
        TicketAIAnalysis.ticket_id == ticket_id,
        TicketAIAnalysis.id == analysis_id
    ).first()
    if not analysis:
        raise HTTPException(status_code=404, detail="Analysis not found")
    if analysis.approved_by is not None or analysis.approved_at is not None:
        raise HTTPException(
            status_code=409,
            detail="AI recommendation already approved"
        )

    ticket.priority = analysis.suggested_priority
    analysis.approved_by = current_user.id
    analysis.approved_at = datetime.now(timezone.utc)

    db.commit()
    db.refresh(ticket)
    return ticket

@router.patch("/{ticket_id}/analyses/{analysis_id}/approve-reply",response_model=TicketAIAnalysisResponse)
def approve_reply(ticket_id:int,
                  analysis_id:int,
                  reply_data:TicketReplyApproval,
                  db:Session=Depends(get_db),
                  current_user=Depends(require_role("agent"))) :
    ticket=db.query(Ticket).filter(Ticket.id==ticket_id,Ticket.assigned_to==current_user.id).first()
    if not ticket:
        raise HTTPException(
            status_code=404,
            detail="Ticket not found"
        )
    analysis=db.query(TicketAIAnalysis).filter(TicketAIAnalysis.id==analysis_id,TicketAIAnalysis.ticket_id==ticket_id).first()
    if not analysis:
        raise HTTPException(
            status_code=404,
            detail="Analysis not found"
        )
    if analysis.reply_approved_at is not None:
        raise HTTPException(
        status_code=409,
        detail="AI reply already approved"
    )

    analysis.approved_reply = reply_data.approved_reply
    analysis.reply_approved_by = current_user.id
    analysis.reply_approved_at = datetime.now(timezone.utc)

    
    db.add(
        TicketMessage(
            ticket_id=ticket_id,
            sender_id=current_user.id,
            sender_role="agent",
            body=reply_data.approved_reply,
            source="ai_approved",
        )
    )

    db.commit()
    db.refresh(analysis)
    return analysis



@router.get("/{ticket_id}/messages", response_model=list[TicketMessageResponse])
def list_ticket_messages(
    ticket_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    ticket = db.query(Ticket).filter(Ticket.id == ticket_id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")

    role = current_user.role
    if role == "customer" and ticket.customer_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not allowed")
    if role == "agent" and ticket.assigned_to != current_user.id:
        raise HTTPException(status_code=403, detail="Not allowed")
    if role not in ("customer", "agent", "admin"):
        raise HTTPException(status_code=403, detail="Not allowed")

    rows = (
        db.query(TicketMessage)
        .filter(TicketMessage.ticket_id == ticket_id)
        .order_by(TicketMessage.created_at.asc())
        .all()
    )
    return rows


@router.post("/{ticket_id}/messages", response_model=TicketMessageResponse, status_code=201)
def post_ticket_message(
    ticket_id: int,
    payload: TicketMessageCreate,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    ticket = db.query(Ticket).filter(Ticket.id == ticket_id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")

    role = current_user.role
    if role == "customer":
        if ticket.customer_id != current_user.id:
            raise HTTPException(status_code=403, detail="Not allowed")
        if ticket.status in ("closed",):
            raise HTTPException(status_code=409, detail="This ticket is closed. You cannot reply.")
    elif role == "agent":
        if ticket.assigned_to != current_user.id:
            raise HTTPException(status_code=403, detail="Not allowed")
    else:
        raise HTTPException(status_code=403, detail="Only customers and assigned agents can post messages")

    body = payload.body.strip()
    if not body:
        raise HTTPException(status_code=422, detail="Message cannot be empty")

    msg = TicketMessage(
        ticket_id=ticket_id,
        sender_id=current_user.id,
        sender_role="customer" if role == "customer" else "agent",
        body=body,
        source="manual",
    )
    db.add(msg)
    
    ticket.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(msg)
    return msg


@router.get("/{ticket_id}/support-replies")
def get_support_replies(
    ticket_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_role("customer")),
):
    """Customer-facing: only approved agent/AI replies for their own ticket."""
    ticket = db.query(Ticket).filter(
        Ticket.id == ticket_id,
        Ticket.customer_id == current_user.id,
    ).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")

    rows = (
        db.query(TicketAIAnalysis)
        .filter(
            TicketAIAnalysis.ticket_id == ticket_id,
            TicketAIAnalysis.reply_approved_at.isnot(None),
            TicketAIAnalysis.approved_reply.isnot(None),
        )
        .order_by(TicketAIAnalysis.reply_approved_at.desc())
        .all()
    )
    return [
        {
            "id": row.id,
            "reply": row.approved_reply,
            "approved_at": row.reply_approved_at,
            "approved_by": row.reply_approved_by,
            "category": row.category,
            "sources": row.sources or [],
        }
        for row in rows
    ]


@router.post("/{ticket_id}/chat", response_model=TicketChatResponse)
def customer_ticket_chat(ticket_id: int, chat_data: TicketChatRequest,
                         db: Session = Depends(get_db),
                         current_user=Depends(require_role("customer"))):
    ticket = db.query(Ticket).filter(
        Ticket.id == ticket_id, Ticket.customer_id == current_user.id
    ).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")

    latest_reply = (
        db.query(TicketAIAnalysis)
        .filter(
            TicketAIAnalysis.ticket_id == ticket_id,
            TicketAIAnalysis.reply_approved_at.isnot(None),
            TicketAIAnalysis.approved_reply.isnot(None),
        )
        .order_by(TicketAIAnalysis.reply_approved_at.desc())
        .first()
    )
    ticket_context = {
        "ticket_id": ticket.id,
        "title": ticket.title,
        "description": ticket.description,
        "status": ticket.status,
        "priority": ticket.priority,
        "created_at": ticket.created_at.isoformat() if ticket.created_at else None,
        "updated_at": ticket.updated_at.isoformat() if ticket.updated_at else None,
        "assigned_agent_id": ticket.assigned_to,
        "latest_support_reply": latest_reply.approved_reply if latest_reply else None,
        "latest_support_reply_at": (
            latest_reply.reply_approved_at.isoformat()
            if latest_reply and latest_reply.reply_approved_at
            else None
        ),
    }
    history = [item.model_dump() for item in chat_data.history]
    try:
        result = answer_ticket_question(ticket_context, chat_data.message, history)
    except Exception as exc:
        logger.exception("ResolveIQ customer chat failed for ticket %s", ticket_id)
        raise HTTPException(
            status_code=503,
            detail="ResolveIQ is temporarily unavailable. Check Gemini access and knowledge-base indexing, then try again.",
        ) from exc
    return {"ticket_id": ticket.id, "answer": result["answer"], "sources": result.get("sources", [])}
