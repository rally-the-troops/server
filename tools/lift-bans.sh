#!/bin/bash

sqlite3 db <<EOF

begin immediate;

.mode column

create temporary view tm_lift_ban_view as
	select
		user_id,
		name,
		date(timeout_last),
		timeout_total,
		games_since_timeout,
		(games_since_timeout > timeout_total) and (julianday() > julianday(timeout_last)+14) as lift_ban
	from
		user_profile_view
	where
		user_id in (select user_id from tm_banned)
	order by lift_ban desc, timeout_last asc
;

select * from tm_lift_ban_view;

delete from tm_banned where user_id in (select user_id from tm_lift_ban_view where lift_ban) returning user_id;

commit;

EOF
