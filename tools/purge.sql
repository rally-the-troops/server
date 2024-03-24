-- Prune game snapshot and game state data to save database space.

create temporary view prune_snap_list as
	select
		distinct game_id
	from
		game_snap
	where
		game_id in (
			select game_id from games
			where status=2 and date(mtime) < date('now', '-7 days')
		)
	;

create temporary view prune_all_list as
	select
		distinct game_id
	from
		games
	where
		game_id in (
			select game_id from games
			where status=2 and date(mtime) < date('now', '-28 days')
		)
	;

begin;

select 'PURGE SNAPS FROM ' || count(1) from prune_snap_list;
delete from game_snap where game_id in (select game_id from prune_snap_list);

select 'PURGE ALL FROM ' || count(1) from prune_all_list;
update games set status = 3 where game_id in (select game_id from prune_all_list);

commit;
