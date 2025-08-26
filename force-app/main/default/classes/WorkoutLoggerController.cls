public with sharing class WorkoutLoggerController {

    // ------------------ WRAPPER ------------------
    public class WorkoutSetWrapper {
        @AuraEnabled public Id Id;
        @AuraEnabled public Integer Reps;
        @AuraEnabled public Decimal Weight_Kg;
        @AuraEnabled public Decimal Weight_Lbs;
        @AuraEnabled public Decimal Plates;
        @AuraEnabled public String exerciseName;
        @AuraEnabled public Integer SetCount;
        @AuraEnabled public Integer SetNumber;
    }

    // ------------------ SESSION METHODS ------------------
    @AuraEnabled(cacheable=true)
    public static Workout_Session__c getTodaySession() {
        Date today = Date.today();
        List<Workout_Session__c> sessions = [
            SELECT Id, Session_Date__c
            FROM Workout_Session__c
            WHERE Session_Date__c = :today AND Is_Active__c = TRUE
            LIMIT 1
        ];
        return sessions.isEmpty() ? null : sessions[0];
    }

    @AuraEnabled
    public static void endWorkoutSession(Id sessionId) {
        Workout_Session__c session = [
            SELECT Id, Is_Active__c
            FROM Workout_Session__c
            WHERE Id = :sessionId
            LIMIT 1
        ];
        session.Is_Active__c = false;
        session.Workout_End_Time__c = System.now();
        update session;
    }

    @AuraEnabled
    public static Workout_Session__c createWorkoutSession() {
        Workout_Session__c session = new Workout_Session__c(
            Session_Date__c = Date.today(),
            Workout_Start_Time__c = System.now(),
            Is_Active__c = true
        );
        insert session;
        return session;
    }

    // ------------------ WORKOUT SET METHODS ------------------
    @AuraEnabled
    public static void createWorkoutSet(Id sessionId, Id exerciseId, Integer reps, Decimal weight, String unit) {
        Decimal weightKg;
        Decimal weightLbs;
        Decimal plates;

        if (unit == 'kg') {
            weightKg = weight;
            weightLbs = weight * 2.2046;
        } else if (unit == 'lbs') {
            weightLbs = weight;
            weightKg = weight / 2.2046;
        } else if (unit == 'plates') {
            plates = weight;
        } else {
            throw new AuraHandledException('Unsupported unit: ' + unit);
        }

        Integer existingCount = [
            SELECT count()
            FROM Workout_Set__c
            WHERE Workout_Session__c = :sessionId AND Exercise__c = :exerciseId
        ];

        Workout_Set__c workoutSet = new Workout_Set__c(
            Workout_Session__c = sessionId,
            Exercise__c = exerciseId,
            Reps__c = reps,
            Weight_Kg__c = weightKg,
            Weight_Lbs__c = weightLbs,
            Plates__c = plates,
            Set_Number__c = existingCount + 1
        );
        insert workoutSet;

        // --- Check PRs ---
        updatePRs(exerciseId, workoutSet);
    }

    @AuraEnabled(cacheable=false)
    public static List<WorkoutSetWrapper> getWorkoutSets(Id sessionId) {
        List<Workout_Set__c> sets = [
            SELECT Id, Reps__c, Weight_Kg__c, Weight_Lbs__c, Plates__c,
                   Exercise__r.Name, Exercise__c, CreatedDate, Set_Number__c
            FROM Workout_Set__c
            WHERE Workout_Session__c = :sessionId
            ORDER BY CreatedDate
        ];

        Map<Id, Integer> setCounterByExercise = new Map<Id, Integer>();
        List<WorkoutSetWrapper> result = new List<WorkoutSetWrapper>();

        for (Workout_Set__c s : sets) {
            Integer count = setCounterByExercise.containsKey(s.Exercise__c)
                ? setCounterByExercise.get(s.Exercise__c) + 1
                : 1;
            setCounterByExercise.put(s.Exercise__c, count);

            WorkoutSetWrapper wrap = new WorkoutSetWrapper();
            wrap.Id = s.Id;
            wrap.Reps = s.Reps__c != null ? (Integer)s.Reps__c : null;
            wrap.Weight_Kg = s.Weight_Kg__c;
            wrap.Weight_Lbs = s.Weight_Lbs__c;
            wrap.Plates = s.Plates__c != null ? (Integer)s.Plates__c : null;
            wrap.exerciseName = s.Exercise__r != null ? s.Exercise__r.Name : 'Unknown';
            wrap.SetCount = count;
            wrap.SetNumber = s.Set_Number__c != null ? (Integer)s.Set_Number__c : null;

            result.add(wrap);
        }
        return result;
    }

    @AuraEnabled
    public static Workout_Set__c getLastSetForExercise(Id exerciseId) {
        List<Workout_Set__c> sets = [
            SELECT Reps__c, Weight_Kg__c, Weight_Lbs__c
            FROM Workout_Set__c
            WHERE Exercise__c = :exerciseId
            ORDER BY CreatedDate DESC
            LIMIT 1
        ];
        return sets.isEmpty() ? null : sets[0];
    }

    @AuraEnabled
    public static void deleteWorkoutSet(Id setId) {
        delete [SELECT Id FROM Workout_Set__c WHERE Id = :setId];
    }

    // ------------------ PR LOGIC ------------------
    private static void updatePRs(Id exerciseId, Workout_Set__c newSet) {
        if (newSet.Weight_Kg__c == null || newSet.Reps__c == null) return;

        // Define PR types we want to check
        List<Integer> repTargets = new List<Integer>{1, 5, 10};

        for (Integer target : repTargets) {
            if (newSet.Reps__c >= target) {
                upsertPR(exerciseId, newSet, target + 'RM');
            }
        }

        // Always check "Heaviest" PR (regardless of reps)
        upsertPR(exerciseId, newSet, 'Heaviest');
    }

    private static void upsertPR(Id exerciseId, Workout_Set__c newSet, String prType) {
        List<Personal_Record__c> prs = [
            SELECT Id, Weight_Kg__c, Reps__c
            FROM Personal_Record__c
            WHERE Exercise__c = :exerciseId
            AND PR_Type__c = :prType
            LIMIT 1
        ];

        Boolean isNewPR = false;
        if (prs.isEmpty()) {
            isNewPR = true;
        } else {
            Personal_Record__c currentPR = prs[0];
            if (newSet.Weight_Kg__c > currentPR.Weight_Kg__c ||
               (newSet.Weight_Kg__c == currentPR.Weight_Kg__c && newSet.Reps__c > currentPR.Reps__c)) {
                isNewPR = true;
                delete currentPR;
            }
        }

        if (isNewPR) {
            Personal_Record__c pr = new Personal_Record__c(
                Exercise__c = exerciseId,
                PR_Type__c = prType,
                Reps__c = newSet.Reps__c,
                Weight_Kg__c = newSet.Weight_Kg__c,
                Weight_Lbs__c = newSet.Weight_Lbs__c,
                Workout_Set__c = newSet.Id,
                Date_Achieved__c = Date.today()
            );
            insert pr;
        }
    }

    // ------------------ EXERCISE HELPERS ------------------
    @AuraEnabled(cacheable=true)
    public static List<String> getMuscleGroups() {
        Set<String> groups = new Set<String>();
        for (Exercise__c ex : [
            SELECT Muscle_Group__c
            FROM Exercise__c
            WHERE Muscle_Group__c != NULL
        ]) {
            groups.add(ex.Muscle_Group__c);
        }
        return new List<String>(groups);
    }

    @AuraEnabled(cacheable=true)
    public static List<Exercise__c> getExercisesByMuscleGroup(String muscleGroup) {
        return [
            SELECT Id, Name
            FROM Exercise__c
            WHERE Muscle_Group__c = :muscleGroup
            ORDER BY Name
        ];
    }

    @AuraEnabled(cacheable=true)
    public static List<Exercise__c> getExercises() {
        return [
            SELECT Id, Name
            FROM Exercise__c
            ORDER BY Name
        ];
    }
}