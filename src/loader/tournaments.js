const indexLoader = require('./index-loader');
const teamLoader = require('./team-loader');
const mapsLoader = require('./maps-loader');
const client = require('../client/fftbg');
const dumps = require('./dumps');
const winners = require('./winners');
const { TEAM_NAMES } = require('../data/constants');
const { Tournament, TournamentMap, TournamentWinner } = require('../models');
const pick = require('lodash/pick');

const getCurrentTournamentId = async () => {
    const { data } = await client.tournamentList();
    const { dumpFiles, latestTournament } = indexLoader.load(data);
    await Promise.all(
        dumpFiles.map(async ({ name, timestamp }) => {
            const loader = dumps.loaderForFileName(name);
            if (loader) {
                return loader.reload(timestamp);
            }
            return Promise.resolve();
        }),
    );
    return latestTournament;
};

const loadTeamFromStringOrDieTrying = (data, teamName) => {
    try {
        return teamLoader.loadTeamFromString(data);
    } catch (error) {
        throw new Error(`Failed to load ${teamName}: ${error.message}`)
    }
};

const createRecordsForTournament = async (tournamentLabel, maps, teamData) => {
    const tournament = await Tournament.create({
        label: tournamentLabel,
    });
    for (const [index, map] of maps.entries()) {
        await TournamentMap.findOrCreate({
            where: {
                ...map,
                order: index,
                TournamentId: tournament.id,
            },
        });
    }
    await winners.loadWinnersForTournament(tournamentLabel);
    for (const teamName of TEAM_NAMES) {
        const team = await tournament.createTeam({
            name: teamName,
        });
        const units = teamData[teamName];
        let index = 0;
        for (const unit of units) {
            const unitRecord = await team.createUnit({
                ...pick(unit, 'name', 'gender', 'zodiac', 'brave', 'faith', 'class', 'subSkill', 'reactSkill', 'supportSkill', 'moveSkill'),
                order: index,
            });
            index += 1;
            for (const name of unit.mainAbilities) {
                await unitRecord.createUnitAbility({
                    name,
                    mainOrSub: 'main',
                });
            }
            for (const name of unit.subAbilities) {
                await unitRecord.createUnitAbility({
                    name,
                    mainOrSub: 'sub',
                });
            }
            for (const name of unit.gear) {
                await unitRecord.createUnitEquipment({ name });
            }
        }
    }
    return tournament;
};

module.exports.loadTournamentById = async (tournamentId) => {
    const label = tournamentId; // TODO fix this
    const existing = await Tournament.findOne({
        where: { label },
        include: TournamentWinner,
    });
    if (existing) {
        return existing;
    }
    const teamUnits = {};
    for (const teamName of TEAM_NAMES) {
        const { data } = await client.tournamentTeam(label, teamName);
        const units = loadTeamFromStringOrDieTrying(data, teamName);
        teamUnits[teamName] = units;
    }
    const maps = await mapsLoader.getMaps(label);
    return createRecordsForTournament(label, maps, teamUnits);
};

module.exports.loadCurrentTournament = async () => {
    const latest = await getCurrentTournamentId();
    const tournament = await Tournament.findOne({
        where: {
            label: latest,
        },
    });
    if (!tournament) {
        await this.loadTournament(latest);
    }
};