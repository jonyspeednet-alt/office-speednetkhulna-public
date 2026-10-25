import React from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import { getLeaveEvents } from '../services/calendarService';
import Swal from 'sweetalert2';
import moment from 'moment';

const LeaveCalendar = () => {

  // Function to fetch events based on current view dates
  // FullCalendar calls this function automatically when view changes
  const fetchEvents = async (info, successCallback, failureCallback) => {
    try {
      const events = await getLeaveEvents(info.startStr, info.endStr);
      successCallback(events);
    } catch (error) {
      failureCallback(error);
    }
  };

  const handleEventClick = (info) => {
    const event = info.event;
    const props = event.extendedProps;

    Swal.fire({
      title: event.title,
      html: `
        <div class="text-start">
          <strong>Employee:</strong> ${props.employee_name}<br>
          <strong>Leave Type:</strong> ${props.leave_type_name}<br>
          <strong>Start:</strong> ${moment(event.start).format('DD MMMM, YYYY')}<br>
          <strong>End:</strong> ${moment(props.original_end_date).format('DD MMMM, YYYY')}<br>
          <strong>Reason:</strong> ${props.reason || 'N/A'}<br>
          <strong>Status:</strong> ${props.status}
        </div>
      `,
      icon: 'info',
      confirmButtonText: 'Close',
      confirmButtonColor: '#4318ff'
    });
  };

  return (
    <div className="container-fluid p-4">
      <div className="mb-4">
        <h3 className="fw-bold text-dark mb-1">Leave Calendar</h3>
        <p className="text-muted small">A visual overview of approved leaves</p>
      </div>

      <div className="card border-0 shadow-sm rounded-4 p-4 bg-white">
        <style>{`
          .fc .fc-toolbar-title { font-size: 1.5em; font-weight: 700; color: #2b3674; }
          .fc .fc-button-primary { background-color: #4318ff; border-color: #4318ff; }
          .fc .fc-button-primary:hover { background-color: #3614cc; border-color: #3614cc; }
        `}</style>
        <FullCalendar
          plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
          initialView="dayGridMonth"
          headerToolbar={{
            left: 'prev,next today',
            center: 'title',
            right: 'dayGridMonth,timeGridWeek,timeGridDay'
          }}
          events={fetchEvents}
          eventClick={handleEventClick}
          height="auto"
        />
      </div>
    </div>
  );
};

export default LeaveCalendar;