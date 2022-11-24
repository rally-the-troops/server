begin transaction;
create temporary table replay_repack as
	select game_id,role,action,arguments
	from game_replay
	order by game_id,replay_id;
delete from game_replay;
insert into game_replay (game_id,role,action,arguments) select * from replay_repack;
commit;
