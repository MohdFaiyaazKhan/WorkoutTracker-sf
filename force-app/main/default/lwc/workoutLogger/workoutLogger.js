import { LightningElement, track } from 'lwc';
import getTodaySession from '@salesforce/apex/WorkoutLoggerController.getTodaySession';
import createWorkoutSession from '@salesforce/apex/WorkoutLoggerController.createWorkoutSession';
import getExercisesByMuscleGroup from '@salesforce/apex/WorkoutLoggerController.getExercisesByMuscleGroup';
import getMuscleGroups from '@salesforce/apex/WorkoutLoggerController.getMuscleGroups';
import createWorkoutSet from '@salesforce/apex/WorkoutLoggerController.createWorkoutSet';
import getWorkoutSets from '@salesforce/apex/WorkoutLoggerController.getWorkoutSets';
import endWorkoutSession from '@salesforce/apex/WorkoutLoggerController.endWorkoutSession';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { refreshApex } from '@salesforce/apex';

export default class WorkoutLogger extends LightningElement {
    // Session tracking
    @track sessionId;
    @track sessionExists = false;
    @track sessionDate = '';
    
    // Form fields
    @track muscleGroupOptions = [];
    @track selectedMuscleGroup;
    @track exerciseOptions = [];
    @track selectedExerciseId;
    @track reps;
    @track weight;
    @track unit = 'kg';
    @track rpe;
    @track notes;
    
    // Data tracking
    @track loggedSets = [];
    @track allLoggedSets = [];
    @track isLoading = false;
    @track tableVisible = true;
    
    // Statistics
    @track totalSets = 0;
    @track uniqueExercises = 0;
    @track totalReps = 0;
    @track maxWeight = 0;
    
    // Sorting
    @track sortedBy = 'SetCount';
    @track sortedDirection = 'asc';
    
    // Configuration
    unitOptions = [
        { label: 'kg', value: 'kg' },
        { label: 'lbs', value: 'lbs' },
        { label: 'plates', value: 'plates' }
    ];

    columns = [
        { 
            label: 'Exercise', 
            fieldName: 'exerciseName', 
            type: 'text',
            sortable: true,
            cellAttributes: { class: { fieldName: 'exerciseClass' } }
        },
        { 
            label: 'Reps', 
            fieldName: 'Reps', 
            type: 'number',
            sortable: true,
            cellAttributes: { alignment: 'center' }
        },
        { 
            label: 'Weight', 
            fieldName: 'Weight_Kg', 
            type: 'number',
            sortable: true,
            typeAttributes: { minimumFractionDigits: 1 },
            cellAttributes: { alignment: 'center' }
        },/*
        { 
            label: 'Unit', 
            fieldName: 'Unit__c', 
            type: 'text',
            cellAttributes: { alignment: 'center' }
        },
        { 
            label: 'RPE', 
            fieldName: 'RPE__c', 
            type: 'number',
            cellAttributes: { 
                alignment: 'center',
                class: { fieldName: 'rpeClass' }
            }
        },*/
        { 
            label: 'Set', 
            fieldName: 'SetCount', 
            type: 'number',
            sortable: true,
            cellAttributes: { alignment: 'center' }
        }/*,
        { 
            label: 'Notes', 
            fieldName: 'Notes__c', 
            type: 'text',
            wrapText: true
        },
        {
            label: 'Time',
            fieldName: 'CreatedDate',
            type: 'date',
            typeAttributes: {
                year: 'numeric',
                month: 'short',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            },
            sortable: true,
            initialWidth: 150
        }*/
    ];

    // Computed properties
    get unitAbbreviation() {
        if (this.unit === 'kg') return 'kg';
        if (this.unit === 'lbs') return 'lbs';
        if (this.unit === 'plates') return 'plates';
        return '';
    }

    get toggleTableTitle() {
        return this.tableVisible ? 'Collapse' : 'Expand';
    }

    connectedCallback() {
        this.initializeLogger();
    }

    async initializeLogger() {
        this.isLoading = true;
        try {
            const session = await getTodaySession();
            if (session) {
                this.sessionId = session.Id;
                this.sessionExists = true;
                this.sessionDate = this.formatDate(session.Session_Date__c);
                await this.loadWorkoutSets();
            }
            await this.loadMuscleGroups();
        } catch (error) {
            this.showToast('Error', 'Failed to initialize workout logger', 'error');
            console.error('Initialization error:', error);
        } finally {
            this.isLoading = false;
        }
    }

    formatDate(dateString) {
        return new Date(dateString).toLocaleDateString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    }

    showToast(title, message, variant) {
        this.dispatchEvent(new ShowToastEvent({
            title,
            message,
            variant
        }));
    }

    async loadMuscleGroups() {
        try {
            const groups = await getMuscleGroups();
            this.muscleGroupOptions = groups.map(group => ({ 
                label: group, 
                value: group 
            }));
        } catch (error) {
            console.error('Error loading muscle groups:', error);
        }
    }

    async handleMuscleGroupChange(event) {
        this.selectedMuscleGroup = event.detail.value;
        this.selectedExerciseId = null;
        this.exerciseOptions = [];
        
        if (this.selectedMuscleGroup) {
            try {
                const exercises = await getExercisesByMuscleGroup({ 
                    muscleGroup: this.selectedMuscleGroup 
                });
                this.exerciseOptions = exercises.map(ex => ({ 
                    label: ex.Name, 
                    value: ex.Id 
                }));
            } catch (error) {
                console.error('Error loading exercises:', error);
            }
        }
    }

    async loadWorkoutSets() {
        this.isLoading = true;
        try {
            const sets = await getWorkoutSets({ sessionId: this.sessionId });
            this.allLoggedSets = sets;
            this.loggedSets = [...sets];
            this.calculateStatistics();
        } catch (error) {
            this.showToast('Error', 'Failed to load workout sets', 'error');
            console.error('Error loading sets:', error);
        } finally {
            this.isLoading = false;
        }
    }

    calculateStatistics() {
        this.totalSets = this.allLoggedSets.length;
        
        // Calculate unique exercises
        const uniqueExerciseIds = new Set(
            this.allLoggedSets.map(set => set.Exercise__c)
        );
        this.uniqueExercises = uniqueExerciseIds.size;
        
        // Calculate total reps and max weight
        this.totalReps = this.allLoggedSets.reduce((sum, set) => sum + (set.Reps || 0), 0);
        this.maxWeight = Math.max(...this.allLoggedSets.map(set => set.Weight_Kg || 0), 0);
    }

    async handleCreateSession() {
        this.isLoading = true;
        try {
            const session = await createWorkoutSession();
            this.sessionId = session.Id;
            this.sessionExists = true;
            this.sessionDate = this.formatDate(session.Session_Date__c);
            this.showToast('Success', 'New workout session started', 'success');
        } catch (error) {
            this.showToast('Error', 'Failed to create session', 'error');
            console.error('Error creating session:', error);
        } finally {
            this.isLoading = false;
        }
    }

    validateForm() {
        const inputs = this.template.querySelectorAll('lightning-input, lightning-combobox');
        let isValid = true;
        
        inputs.forEach(input => {
            if (input.required && !input.value) {
                input.reportValidity();
                isValid = false;
            }
        });
        
        return isValid;
    }

    async handleAddSet() {
        if (!this.validateForm()) {
            return;
        }

        this.isLoading = true;
        try {
            await createWorkoutSet({
                sessionId: this.sessionId,
                exerciseId: this.selectedExerciseId,
                reps: this.reps,
                weight: this.weight,
                unit: this.unit,
                rpe: this.rpe,
                notes: this.notes
            });

            // Clear form
            this.handleClearForm();
            
            // Refresh data
            await refreshApex(this.allLoggedSets);
            await this.loadWorkoutSets();
            
            this.showToast('Success', 'Workout set added successfully', 'success');
        } catch (error) {
            this.showToast('Error', 'Failed to add workout set', 'error');
            console.error('Error adding set:', error);
        } finally {
            this.isLoading = false;
        }
    }

    handleClearForm() {
        this.reps = null;
        this.weight = null;
        this.rpe = null;
        this.notes = null;
        
        // Reset validation
        const inputs = this.template.querySelectorAll('lightning-input');
        inputs.forEach(input => {
            input.setCustomValidity('');
            input.reportValidity();
        });
    }

    async handleEndSession() {
        if (!confirm('Are you sure you want to end this workout session? This action cannot be undone.')) {
            return;
        }

        this.isLoading = true;
        try {
            await endWorkoutSession({ sessionId: this.sessionId });
            
            this.sessionId = null;
            this.sessionExists = false;
            this.sessionDate = '';
            this.loggedSets = [];
            this.allLoggedSets = [];
            
            this.showToast('Success', 'Workout session ended successfully', 'success');
        } catch (error) {
            this.showToast('Error', 'Failed to end workout session', 'error');
            console.error('Error ending session:', error);
        } finally {
            this.isLoading = false;
        }
    }

    handleRefreshTable() {
        this.loadWorkoutSets();
        this.showToast('Info', 'Refreshing workout data...', 'info');
    }

    toggleTableVisibility() {
        this.tableVisible = !this.tableVisible;
    }

    handleSortData(event) {
        this.sortedBy = event.detail.fieldName;
        this.sortedDirection = event.detail.sortDirection;
        this.sortData(this.sortedBy, this.sortedDirection);
    }

    sortData(fieldName, sortDirection) {
        const reverse = sortDirection === 'desc' ? -1 : 1;
        this.loggedSets.sort((a, b) => {
            const valueA = a[fieldName] || '';
            const valueB = b[fieldName] || '';
            return reverse * ((valueA > valueB) - (valueB > valueA));
        });
    }

    handleLoadMore(event) {
        // Implement lazy loading if needed
        event.target.isLoading = false;
    }

    // Event handlers for new fields
    handleExerciseChange(event) {
        this.selectedExerciseId = event.detail.value;
    }

    handleRepsChange(event) {
        this.reps = event.detail.value;
    }

    handleWeightChange(event) {
        this.weight = event.detail.value;
    }

    handleUnitChange(event) {
        this.unit = event.detail.value;
    }

    handleRpeChange(event) {
        this.rpe = event.detail.value;
    }

    handleNotesChange(event) {
        this.notes = event.detail.value;
    }
}